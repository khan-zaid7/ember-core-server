
// userController.js (or wherever your main sync logic is)

import { createUserDoc, updateUserDoc } from '../../models/userModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const usersCollection = db.collection('users');
import bcrypt from 'bcryptjs'; 
import { toISOStringSafe } from '../../config/toISOString.js';

// === Input Validators ===
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function isValidPhoneNumber(phone) {
  return (
    typeof phone === 'string' &&
    /^(\+\d{1,3}[- ]?)?\d{10,15}$/.test(phone.replace(/\s/g, ''))
  );
}

/**
 * Checks if a value for a unique field (e.g., email, phone_number) already exists for another user.
 * @param {string} field - The field to check (e.g., 'email', 'phone_number')
 * @param {string} value - The value of the field
 * @param {string} [currentUserId=null] - The current user's ID (to exclude from check)
 * @returns {Promise<Object|null>}
 */
async function checkUniqueFieldExists(field, value, currentUserId = null) {
  if (!value) return null;
  const snapshot = await usersCollection.where(field, '==', value).get();
  if (snapshot.empty) return null;
  if (snapshot.size > 1) {
    console.warn(
      `⚠️ Multiple documents found for unique field "${field}" with value "${value}". Data may be corrupted!`
    );
  }
  const firstOtherDoc = snapshot.docs.find(
    (doc) => !currentUserId || doc.id !== currentUserId
  );
  if (!firstOtherDoc) return null;
  return {
    exists: true,
    data: firstOtherDoc.data(),
    id: firstOtherDoc.id,
  };
}

/**
 * Checks if two user profiles are likely the same person based on matching data,
 * *including a direct password comparison*, as explicitly requested for this project context.
 *
 * This function is used when a primary unique field (like email or phone_number) has
 * already caused a potential conflict, and it's called to confirm if the profiles
 * are from the same individual using *supporting* identifying data, including password.
 *
 * @param {Object} clientData - The user data from the client (e.g., a new local registration or update).
 * @param {Object} serverData - An existing user's profile data from your database, conflicting on a unique field.
 * This is assumed to contain a 'password' field that can be directly compared.
 * @returns {boolean} - True if profiles likely belong to same person based on supporting fields, including password.
 */
async function isSameUserProfile(clientData, serverData) { 
  const supportingFields = ['name', 'role'];

  let matchCount = 0;
  let totalFieldsToConsider = 0; // Counts fields with meaningful data on both sides
  const matchDetails = {};

  // --- 1. Strongest Check: User ID (Firebase UID) ---
  // If user_id is present on both sides and they match, it's the most definitive sign.
  if (clientData.user_id && serverData.user_id) {
    totalFieldsToConsider++;
    const userIdMatch = clientData.user_id === serverData.user_id;
    matchDetails.user_id = userIdMatch;
    if (userIdMatch) {
      matchCount++;
      console.log(`🔍 Identity comparison: Primary UID Match Found! (${clientData.user_id})`);
      return true; // Immediate strong match
    }
  } else {
    matchDetails.user_id = 'skipped (client UID not present or server UID missing)';
  }

  // --- 2. Very Strong Supporting Check: Password (SECURE COMPARISON with bcrypt) ---
  // This now securely compares the plaintext client password against the hashed server password.
  if (clientData.password && serverData.password) {
    totalFieldsToConsider++;
    try {
      console.log(clientData.password);
      console.log(serverData.password);
      // Use bcrypt.compare to check the plaintext password against the hash
      const passwordMatch = await bcrypt.compare(clientData.password, serverData.password); // <<< AWAITING BCRYPT.COMPARE
      matchDetails.password = passwordMatch;
      if (passwordMatch) {
        matchCount++;
        console.log(`🔑 Identity comparison: Password Match Found securely!`);
      }
    } catch (error) {
      console.error("Error during bcrypt password comparison:", error);
      matchDetails.password = false; // Treat any error during comparison as a non-match
    }
  } else {
    matchDetails.password = 'skipped (missing password data for comparison or server hash)';
  }

  // --- 3. Other Supporting Checks: Name, Role ---
  for (const field of supportingFields) {
    const clientValue = clientData[field];
    const serverValue = serverData[field];

    if (clientValue !== undefined && clientValue !== null && clientValue !== '' &&
        serverValue !== undefined && serverValue !== null && serverValue !== '') {
      
      totalFieldsToConsider++;

      let match = false;
      switch (field) {
        case 'name':
          const clientName = String(clientValue).toLowerCase().trim();
          const serverName = String(serverValue).toLowerCase().trim();
          match = clientName === serverName || 
                  clientName.includes(serverName) || 
                  serverName.includes(clientName);
          break;
        case 'role':
          match = clientValue === serverValue;
          break;
        default:
          match = clientValue === serverValue;
          break;
      }
      matchDetails[field] = match;
      if (match) {
        matchCount++;
      }
    } else {
      matchDetails[field] = `skipped (missing ${field} data)`;
    }
  }

  // --- Final Decision Logic ---
  let isSameUserDecision = false;

  const supportingMatchPercentage = totalFieldsToConsider > 0 ? (matchCount / totalFieldsToConsider) : 0;

  // Decision criteria:
  // If UID matched, it's true (handled by early return).
  // Otherwise, if password matched, it's a very strong indicator.
  // OR, if enough other fields align.
  if (matchDetails.password === true) {
      isSameUserDecision = true; 
  } else if (matchCount >= 1 && supportingMatchPercentage >= 0.6) {
      isSameUserDecision = true;
  } else if (totalFieldsToConsider > 0 && matchCount === 0) {
      isSameUserDecision = false;
      console.log("No supporting fields (including UID/password if present) matched.");
  } else if (totalFieldsToConsider === 0) {
      isSameUserDecision = false;
      console.warn("No additional unique or supporting fields available to confirm identity beyond the primary conflict field.");
  } else {
      isSameUserDecision = false;
  }

  // --- Logging for Debugging ---
  console.log(`🔍 Identity comparison (contextual for primary conflict, includes password):`);
  console.log(`   - Client User (ID: ${clientData.user_id || 'N/A'}, Email: ${clientData.email || 'N/A'})`);
  console.log(`   - Server User (ID: ${serverData.user_id || 'N/A'}, Email: ${serverData.email || 'N/A'})`);
  console.log(`   - Match details (UID + Password + Supporting Fields):`, matchDetails);
  console.log(`   - Matched fields count: ${matchCount}/${totalFieldsToConsider}`);
  console.log(`   - Match percentage: ${(totalFieldsToConsider > 0 ? (matchCount / totalFieldsToConsider) * 100 : 0).toFixed(1)}%`);
  console.log(`   - Decision: ${isSameUserDecision ? 'SAME USER' : 'DIFFERENT USER'}`);

  return isSameUserDecision;
}

// === Main Sync Logic, with allowed_strategies in all 409 responses ===
export const syncUserFromClient = async (req, res) => {
  const user = req.body; // 'user' object is directly req.body, so it includes 'password' if sent by client.

  // Basic validation for required fields
  if (
    !user.user_id ||
    !user.name ||
    !user.email ||
    !user.role ||
    !user.updated_at
  ) {
    console.log("Reaching in if 1 (missing base required fields)");
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!isValidEmail(user.email)) {
    console.log("Reaching in if 2 (invalid email format)");
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (user.phone_number && !isValidPhoneNumber(user.phone_number)) {
    console.log("Reaching in if 3 (invalid phone number format)");
    return res.status(400).json({ error: 'Invalid phone number format' });
  }

  try {
    const docRef = usersCollection.doc(user.user_id);
    const doc = await docRef.get();

    if (doc.exists) {
      // User exists in server database, potential update
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(user.updated_at);
      
      console.log("Server Updated at:", serverUpdated);
      console.log("Client updated at:", clientUpdated);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'updated_at',
          latest_data: serverData,
          allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
          client_id: user.user_id,
          server_id: user.user_id, // Same ID for stale updates
        });
      }

      // Unique constraint checks for email (if changed)
      if (user.email !== serverData.email) {
        const emailCheck = await checkUniqueFieldExists('email', user.email, user.user_id);
        if (emailCheck) {
          if (await isSameUserProfile(user, emailCheck.data)) {
            console.log(`🔄 Auto-resolving: Same user detected for email change ${user.email}`);
            
            return res.status(409).json({
              error: 'Conflict: Email belongs to another account that appears to be yours',
              conflict_field: 'email',
              conflict_type: 'potential_duplicate_account',
              latest_data: emailCheck.data,
              allowed_strategies: ['client_wins', 'server_wins', 'merge'], // Options for merging these two potential duplicates
              client_id: user.user_id, // This is the ID of the profile currently being synced
              server_id: emailCheck.id, // This is the ID of the *conflicting* profile found by email
            });
          } else {
            // Different user with same email (hard conflict)
            return res.status(409).json({
              error: 'Conflict: Email already exists for a different user',
              conflict_field: 'email',
              conflict_type: 'unique_constraint',
              latest_data: emailCheck.data,
              allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
            });
          }
        }
      }

      // Unique constraint checks for phone_number (if changed)
      if (user.phone_number && user.phone_number !== serverData.phone_number) {
        const phoneCheck = await checkUniqueFieldExists(
          'phone_number',
          user.phone_number,
          user.user_id
        );
        if (phoneCheck) {
          if (await isSameUserProfile(user, phoneCheck.data)) {
            console.log(`🔄 Auto-resolving: Same user detected for phone change ${user.phone_number}`);
            
            return res.status(409).json({
              error: 'Conflict: Phone number belongs to another account that appears to be yours',
              conflict_field: 'phone_number',
              conflict_type: 'potential_duplicate_account',
              latest_data: phoneCheck.data,
              allowed_strategies: ['client_wins', 'server_wins', 'merge'],
              client_id: user.user_id,
              server_id: phoneCheck.id,
            });
          } else {
            // Different user with same phone
            return res.status(409).json({
              error: 'Conflict: Phone number already exists for a different user',
              conflict_field: 'phone_number',
              conflict_type: 'unique_constraint',
              latest_data: phoneCheck.data,
              allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
            });
          }
        }
      }

      // If no conflicts or stale data, safe to update
      await updateUserDoc(user.user_id, user); // User includes password if client sent it
      console.log(`User ${user.user_id} updated.`);

    } else {
      // User does not exist in server database, potential new creation
      // Check for email conflict on creation
      const emailCheck = await checkUniqueFieldExists('email', user.email);
      if (emailCheck) {
        if (await isSameUserProfile(user, emailCheck.data)) {
          console.log(`🔄 Auto-resolving: Same user detected for email ${user.email} on new registration`);
          
          // Auto-resolve by updating the existing user with new data from client.
          // This merges the new client profile with the existing server profile,
          // usually keeping the server's user_id and updating its fields.
          const mergedData = {
            ...emailCheck.data, // Server's existing data as base
            ...user,            // Overlay client's new data (this includes the password if sent by client)
            user_id: emailCheck.id, // Explicitly keep server's user_id
            updated_at: new Date().toISOString(), // Update timestamp
          };
          
          await updateUserDoc(emailCheck.id, mergedData); // Update the existing server doc
          
          return res.status(200).json({ 
            message: 'User synced successfully (auto-resolved duplicate account via email)',
            resolved_as: 'same_user_detected',
            server_user_id: emailCheck.id, // ID of the profile that was updated
          });
        } else {
          // Different user trying to register with an existing email
          return res.status(409).json({
            error: 'Conflict: Email already exists for a different user',
            conflict_field: 'email',
            conflict_type: 'unique_constraint',
            latest_data: emailCheck.data,
            allowed_strategies: ['client_wins'], // Only client_wins might make sense here if you allow changing their email.
          });
        }
      }

      // Check for phone number conflict on creation (if email didn't conflict)
      const phoneCheck = await checkUniqueFieldExists('phone_number', user.phone_number);
      if (phoneCheck) {
        if (await isSameUserProfile(user, phoneCheck.data)) {
          console.log(`🔄 Auto-resolving: Same user detected for phone ${user.phone_number} on new registration`);
          
          const mergedData = {
            ...phoneCheck.data,
            ...user, // This includes the password if sent by client
            user_id: phoneCheck.id,
            updated_at: new Date().toISOString(),
          };
          
          await updateUserDoc(phoneCheck.id, mergedData);
          
          return res.status(200).json({ 
            message: 'User synced successfully (auto-resolved duplicate account via phone)',
            resolved_as: 'same_user_detected',
            server_user_id: phoneCheck.id,
          });
        } else {
          // Different user trying to register with an existing phone number
          return res.status(409).json({
            error: 'Conflict: Phone number already exists for a different user',
            conflict_field: 'phone_number',
            conflict_type: 'unique_constraint',
            latest_data: phoneCheck.data,
            allowed_strategies: ['client_wins'],
          });
        }
      }

      // If no unique field conflicts, safe to create new user
      await createUserDoc(user.user_id, user); // User includes password if client sent it
      console.log(`New user ${user.user_id} created.`);
    }

    return res.status(200).json({ message: 'User synced successfully' });
  } catch (err) {
    console.error('❌ User sync error:', err);
    return res.status(500).json({ error: 'User sync failed', details: err.message });
  }
};

// === Improved Merge: Dynamic Field Coverage ===
export const resolveUserConflict = (
  clientData,
  serverData,
  strategy = 'merge'
) => {
  switch (strategy) {
    case 'client_wins':
      return { ...clientData };

    case 'server_wins':
      return { ...serverData };

    case 'update_data':
      return {
        ...clientData, // Client's data is the base
        email: serverData.email, // Override email with server's
        phone_number: serverData.phone_number, // Override phone_number with server's
        updated_at: new Date().toISOString(),
        // If clientData has password and serverData also has it, client's password is used
        // as per the spread operator order (...clientData before explicit overrides).
        // If you always want server's password to win in 'update_data', add:
        // password: serverData.password,
      };

    case 'merge':
    default: {
      const clientUpdatedAt = clientData.updated_at
        ? new Date(clientData.updated_at)
        : null;
      const serverUpdatedAt = serverData.updated_at
        ? serverData.updated_at.toDate // Handle Firebase Timestamps
          ? serverData.updated_at.toDate()
          : new Date(serverData.updated_at)
        : null;

      const merged = { ...serverData }; // Start with server's data as base
      const allKeys = [
        ...new Set([
          ...Object.keys(serverData),
          ...Object.keys(clientData),
        ]),
      ];
      // ADD 'password' here to include it in the merge comparison if you want
      // the client's password to take precedence if it's newer.
      const criticalFields = ['email', 'role', 'password']; // <-- ADDED 'password'

      allKeys.forEach((key) => {
        // For critical fields, apply client's value only if client's timestamp is newer AND values differ
        if (criticalFields.includes(key)) {
          if (
            clientUpdatedAt &&
            serverUpdatedAt &&
            clientUpdatedAt > serverUpdatedAt &&
            clientData[key] !== undefined &&
            clientData[key] !== serverData[key]
          ) {
            merged[key] = clientData[key];
          }
        } else if (
          // For non-critical fields, apply client's value if client has it AND client's timestamp is newer AND values differ
          clientData[key] !== undefined &&
          (clientUpdatedAt &&
            serverUpdatedAt &&
            clientUpdatedAt > serverUpdatedAt
            ? clientData[key] !== serverData[key]
            : false)
        ) {
          merged[key] = clientData[key];
        }
      });
      
      // Explicitly set updated_at based on newer timestamp
      merged.updated_at =
        clientUpdatedAt && serverUpdatedAt && clientUpdatedAt > serverUpdatedAt
          ? clientData.updated_at
          : serverData.updated_at;
          
      return merged;
    }
  }
};

// === Conflict Resolution Handler with allowed_strategies in response ===
export const resolveUserSyncConflict = async (req, res) => {
  try {
    const { user_id, resolution_strategy, clientData } = req.body; // clientData should include password

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
        status: 'error',
        allowed_strategies: [],
      });
    }

    const allowed_strategies = [];
    const docRef = usersCollection.doc(user_id);
    const doc = await docRef.get();

    let resolvedData;
    let isNewUser = false;

    if (!doc.exists) {
      // Scenario: Client is trying to sync a user_id that doesn't exist on server (new user)
      isNewUser = true;
      allowed_strategies.push('client_wins'); // For a new user, client_wins is often the only sensible strategy unless you merge into an existing profile via email/phone.

      if (resolution_strategy === 'server_wins' || resolution_strategy === 'update_data') {
        return res.status(400).json({
          success: false,
          message: `Cannot use ${resolution_strategy} strategy for new user - no server data exists`,
          status: 'error',
          allowed_strategies,
        });
      }
      
      // Before creating, re-validate unique constraints for the *new* clientData.
      // This is crucial to prevent creating a new user with an email/phone already taken by *another* existing user.
      const emailCheck = await checkUniqueFieldExists('email', clientData.email, user_id);
      if (emailCheck) {
        return res.status(409).json({
          success: false,
          message: 'Cannot resolve conflict: Email already exists for another user',
          status: 'error',
          conflict_field: 'email',
          conflict_type: 'unique_constraint',
          latest_data: emailCheck.data,
          allowed_strategies: [], // No strategies to "resolve" this as it's a new user with a unique conflict
        });
      }
      const phoneCheck = await checkUniqueFieldExists('phone_number', clientData.phone_number, user_id);
      if (phoneCheck) {
        return res.status(409).json({
          success: false,
          message: 'Cannot resolve conflict: Phone number already exists for another user',
          status: 'error',
          conflict_field: 'phone_number',
          conflict_type: 'unique_constraint',
          latest_data: phoneCheck.data,
          allowed_strategies: [],
        });
      }
      
      resolvedData = { ...clientData }; // For a new user, clientData is the source
    } else {
      // Scenario: User already exists on server, resolving an update conflict
      allowed_strategies.push('client_wins', 'server_wins', 'merge', 'update_data');
      const serverData = doc.data();

      // For 'update_data' strategy, you *must* re-check unique constraints
      // because clientData might have changed email/phone to one already owned by someone else.
      if (resolution_strategy === 'update_data') {
        if (clientData.email !== serverData.email) {
          const emailCheck = await checkUniqueFieldExists('email', clientData.email, user_id);
          if (emailCheck) {
            return res.status(409).json({
              success: false,
              message: 'Cannot resolve conflict: Email already exists for another user',
              status: 'error',
              conflict_field: 'email',
              conflict_type: 'unique_constraint',
              latest_data: emailCheck.data,
              allowed_strategies,
            });
          }
        }
        if (
          clientData.phone_number &&
          clientData.phone_number !== serverData.phone_number
        ) {
          const phoneCheck = await checkUniqueFieldExists(
            'phone_number',
            clientData.phone_number,
            user_id
          );
          if (phoneCheck) {
            return res.status(409).json({
              success: false,
              message: 'Cannot resolve conflict: Phone number already exists for another user',
              status: 'error',
              conflict_field: 'phone_number',
              conflict_type: 'unique_constraint',
              latest_data: phoneCheck.data,
              allowed_strategies,
            });
          }
        }
      }
      resolvedData = resolveUserConflict(clientData, serverData, resolution_strategy);
    }

    // Perform the actual create or update based on the resolved data
    if (isNewUser) {
      await createUserDoc(user_id, resolvedData);
    } else {
      await updateUserDoc(user_id, resolvedData);
    }

    return res.status(200).json({
      success: true,
      message: `Conflict resolved using ${resolution_strategy} strategy${isNewUser ? ' (new user created)' : ' (existing user updated)'}`,
      status: 'resolved',
      user_id,
      resolvedData,
      isNewUser,
      resolution_strategy,
      allowed_strategies,
      client_id: user_id,
      server_id: user_id, // For users, IDs should match after resolution
    });
  } catch (error) {
    console.error('Error resolving user conflict:', error);
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      status: 'error',
      allowed_strategies: [],
    });
  }
};

/**
 * @route GET /api/users/:userId
 * @desc Get a user's profile data by their user_id.
 * @access Private (You should implement authentication/authorization middleware before this route)
 */
export const getUserDataById = async (req, res) => {
    const { userId } = req.params; // Get userId from URL parameters

    try {
        const userDoc = await usersCollection.doc(userId).get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: 'User not found.' });
        }

        let userData = userDoc.data();

        // --- EXCLUDE PASSWORD FIELD ---
        if (userData.password) {
            delete userData.password;
        }

        // Convert Firestore Timestamps for consistency (optional but recommended)
        const formattedUserData = {
            ...userData,
            created_at: toISOStringSafe(userData.created_at),
            updated_at: toISOStringSafe(userData.updated_at),
        };

        return res.status(200).json({
            message: 'User data retrieved successfully',
            user: formattedUserData
        });

    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({ message: 'Failed to retrieve user data.' });
    }
};