import { createUserDoc, updateUserDoc } from '../../models/userModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const usersCollection = db.collection('users');

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
 * Checks if two user profiles are likely the same person based on matching data
 * @param {Object} clientData - The client user data
 * @param {Object} serverData - The server user data
 * @returns {boolean} - True if profiles likely belong to same person
 */
function isSameUserProfile(clientData, serverData) {
  // Define fields to compare for identity matching
  const criticalFields = ['name', 'email', 'phone_number'];
  const optionalFields = ['role']; // Less critical but can help confirm
  
  let matchCount = 0;
  let totalFields = 0;
  let matchDetails = {};
  
  // Check critical fields
  for (const field of criticalFields) {
    if (clientData[field] && serverData[field]) {
      totalFields++;
      
      if (field === 'email') {
        // Email should match exactly (case-insensitive)
        const match = clientData[field].toLowerCase() === serverData[field].toLowerCase();
        matchDetails[field] = match;
        if (match) matchCount++;
      } else if (field === 'name') {
        // Name comparison (case-insensitive, handle minor variations)
        const clientName = clientData[field].toLowerCase().trim();
        const serverName = serverData[field].toLowerCase().trim();
        
        // Check exact match or significant overlap
        const match = clientName === serverName || 
                     clientName.includes(serverName) || 
                     serverName.includes(clientName);
        matchDetails[field] = match;
        if (match) matchCount++;
      } else if (field === 'phone_number') {
        // Phone number comparison (normalize format)
        const clientPhone = clientData[field].replace(/\D/g, '');
        const serverPhone = serverData[field].replace(/\D/g, '');
        
        // Check if numbers match (last 10 digits for international variations)
        const match = clientPhone.slice(-10) === serverPhone.slice(-10);
        matchDetails[field] = match;
        if (match) matchCount++;
      }
    }
  }
  
  // Check optional fields for additional confirmation
  for (const field of optionalFields) {
    if (clientData[field] && serverData[field]) {
      totalFields++;
      const match = clientData[field] === serverData[field];
      matchDetails[field] = match;
      if (match) matchCount++;
    }
  }
  
  // Consider it the same user if:
  // 1. Email matches AND at least one other field matches
  // 2. OR if 80% or more of available fields match
  const emailMatches = clientData.email && serverData.email && 
                      clientData.email.toLowerCase() === serverData.email.toLowerCase();
  const matchPercentage = totalFields > 0 ? (matchCount / totalFields) : 0;
  
  const isSameUser = (emailMatches && matchCount >= 2) || matchPercentage >= 0.8;
  
  // Log the decision for debugging
  console.log(`🔍 Identity comparison for ${clientData.email}:`);
  console.log(`   - Match details:`, matchDetails);
  console.log(`   - Score: ${matchCount}/${totalFields} (${Math.round(matchPercentage * 100)}%)`);
  console.log(`   - Email matches: ${emailMatches}`);
  console.log(`   - Decision: ${isSameUser ? 'SAME USER' : 'DIFFERENT USER'}`);
  
  return isSameUser;
}

// === Main Sync Logic, with allowed_strategies in all 409 responses ===
export const syncUserFromClient = async (req, res) => {
  const user = req.body;
  if (
    !user.user_id ||
    !user.name ||
    !user.email ||
    !user.role ||
    !user.updated_at
  ) {
    console.log("reaching in if 1  ")

    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!isValidEmail(user.email)) {
    console.log("reaching in if 2  ")

    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (user.phone_number && !isValidPhoneNumber(user.phone_number)) {
    console.log("reaching in if 3  ")

    return res.status(400).json({ error: 'Invalid phone number format' });
  }

  try {
    const docRef = usersCollection.doc(user.user_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(user.updated_at);
      
      console.log("server Updated at:", serverUpdated);
      console.log("client udpated at:", clientUpdated);

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

      // Unique constraint checks
      if (user.email !== serverData.email) {
        const emailCheck = await checkUniqueFieldExists('email', user.email, user.user_id);
        if (emailCheck) {
          // Check if this is likely the same user (edge case: user changed devices and email)
          if (isSameUserProfile(user, emailCheck.data)) {
            console.log(`🔄 Auto-resolving: Same user detected for email change ${user.email}`);
            
            // This is tricky - the user might be trying to merge two accounts
            // For now, we'll show a conflict but with merge options
            return res.status(409).json({
              error: 'Conflict: Email belongs to another account that appears to be yours',
              conflict_field: 'email',
              conflict_type: 'potential_duplicate_account',
              latest_data: emailCheck.data,
              allowed_strategies: ['client_wins', 'server_wins', 'merge'],
              client_id: user.user_id,
              server_id: emailCheck.id,
            });
          } else {
            // Different user with same email
            return res.status(409).json({
              error: 'Conflict: Email already exists',
              conflict_field: 'email',
              conflict_type: 'unique_constraint',
              latest_data: emailCheck.data,
              allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
            });
          }
        }
      }
      if (
        user.phone_number &&
        user.phone_number !== serverData.phone_number
      ) {
        const phoneCheck = await checkUniqueFieldExists(
          'phone_number',
          user.phone_number,
          user.user_id
        );
        if (phoneCheck) {
          // Check if this is likely the same user (edge case: user changed devices and phone)
          if (isSameUserProfile(user, phoneCheck.data)) {
            console.log(`🔄 Auto-resolving: Same user detected for phone change ${user.phone_number}`);
            
            // This might be an account merge situation
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
              error: 'Conflict: Phone number already exists',
              conflict_field: 'phone_number',
              conflict_type: 'unique_constraint',
              latest_data: phoneCheck.data,
              allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
            });
          }
        }
      }

      // ✅ Safe to update
      await updateUserDoc(user.user_id, user);
    } else {
      // Create case
      const emailCheck = await checkUniqueFieldExists('email', user.email);
      if (emailCheck) {
        // Check if this is likely the same user on a different device
        if (isSameUserProfile(user, emailCheck.data)) {
          console.log(`🔄 Auto-resolving: Same user detected for email ${user.email}`);
          
          // Auto-resolve by updating the existing user with new data
          // Use the server's user_id but update with client data
          const mergedData = {
            ...emailCheck.data,
            ...user,
            user_id: emailCheck.id, // Keep server's user_id
            updated_at: new Date().toISOString(),
          };
          
          await updateUserDoc(emailCheck.id, mergedData);
          
          return res.status(200).json({ 
            message: 'User synced successfully (auto-resolved duplicate account)',
            resolved_as: 'same_user_detected',
            server_user_id: emailCheck.id,
          });
        } else {
          // Different user with same email - show conflict
          return res.status(409).json({
            error: 'Conflict: Email already exists',
            conflict_field: 'email',
            conflict_type: 'unique_constraint',
            latest_data: emailCheck.data,
            allowed_strategies: ['client_wins'],
          });
        }
      }
      const phoneCheck = await checkUniqueFieldExists(
        'phone_number',
        user.phone_number
      );
      if (phoneCheck) {
        // Check if this is likely the same user (phone conflicts are rarer)
        if (isSameUserProfile(user, phoneCheck.data)) {
          console.log(`🔄 Auto-resolving: Same user detected for phone ${user.phone_number}`);
          
          // Auto-resolve by updating the existing user with new data
          const mergedData = {
            ...phoneCheck.data,
            ...user,
            user_id: phoneCheck.id, // Keep server's user_id
            updated_at: new Date().toISOString(),
          };
          
          await updateUserDoc(phoneCheck.id, mergedData);
          
          return res.status(200).json({ 
            message: 'User synced successfully (auto-resolved duplicate account)',
            resolved_as: 'same_user_detected',
            server_user_id: phoneCheck.id,
          });
        } else {
          // Different user with same phone - show conflict
          return res.status(409).json({
            error: 'Conflict: Phone number already exists',
            conflict_field: 'phone_number',
            conflict_type: 'unique_constraint',
            latest_data: phoneCheck.data,
            allowed_strategies: ['client_wins'],
          });
        }
      }
      // ✅ Safe to create new user
      await createUserDoc(user.user_id, user);
    }

    return res.status(200).json({ message: 'User synced successfully' });
  } catch (err) {
    console.error('❌ User sync error:', err);
    return res.status(500).json({ error: 'User sync failed' });
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
        ...clientData,
        email: serverData.email,
        phone_number: serverData.phone_number,
        updated_at: new Date().toISOString(),
      };

    case 'merge':
    default: {
      const clientUpdatedAt = clientData.updated_at
        ? new Date(clientData.updated_at)
        : null;
      const serverUpdatedAt = serverData.updated_at
        ? serverData.updated_at.toDate
          ? serverData.updated_at.toDate()
          : new Date(serverData.updated_at)
        : null;

      const merged = { ...serverData };
      const allKeys = [
        ...new Set([
          ...Object.keys(serverData),
          ...Object.keys(clientData),
        ]),
      ];
      const criticalFields = ['email', 'role'];

      allKeys.forEach((key) => {
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
    const { user_id, resolution_strategy, clientData } = req.body;

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
      isNewUser = true;
      allowed_strategies.push('client_wins');

      if (resolution_strategy === 'server_wins' || resolution_strategy === 'update_data') {
        return res.status(400).json({
          success: false,
          message: `Cannot use ${resolution_strategy} strategy for new user - no server data exists`,
          status: 'error',
          allowed_strategies,
        });
      }
      // Validate unique constraints
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
      const phoneCheck = await checkUniqueFieldExists('phone_number', clientData.phone_number, user_id);
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
      resolvedData = { ...clientData };
    } else {
      allowed_strategies.push('client_wins', 'server_wins', 'merge', 'update_data');
      const serverData = doc.data();

      // For update_data, check constraints
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