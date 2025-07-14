import { createRegistrationDoc, updateRegistrationDoc } from '../../models/registrationModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const collection = db.collection('registrations');

// === Input Validators ===
function isValidAge(age) {
  return typeof age === 'number' && age >= 0 && age <= 150;
}

function isValidGender(gender) {
  const validGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
  return typeof gender === 'string' && validGenders.includes(gender.toLowerCase());
}

function isValidPersonName(name) {
  return typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 100;
}

/**
 * Checks if a registration with the same person identity already exists
 * @param {string} personName - The person's name
 * @param {number} age - The person's age
 * @param {string} gender - The person's gender
 * @param {string} [currentRegistrationId=null] - The current registration ID (to exclude from check)
 * @returns {Promise<Object|null>}
 */
async function checkPersonIdentityExists(personName, age, gender, currentRegistrationId = null) {
  if (!personName || age === undefined || !gender) return null;
  
  const snapshot = await collection
    .where('person_name', '==', personName)
    .where('age', '==', age)
    .where('gender', '==', gender)
    .get();
    
  if (snapshot.empty) return null;
  
  if (snapshot.size > 1) {
    console.warn(
      `⚠️ Multiple registrations found for person "${personName}", age ${age}, gender ${gender}. Data may be corrupted!`
    );
  }
  
  const firstOtherDoc = snapshot.docs.find(
    (doc) => !currentRegistrationId || doc.id !== currentRegistrationId
  );
  
  if (!firstOtherDoc) return null;
  
  return {
    exists: true,
    data: firstOtherDoc.data(),
    id: firstOtherDoc.id,
  };
}

/**
 * Checks if two registrations are likely for the same person based on matching data
 * @param {Object} clientData - The client registration data
 * @param {Object} serverData - The server registration data
 * @returns {boolean} - True if registrations likely belong to same person
 */
function isSamePersonRegistration(clientData, serverData) {
  // Define fields to compare for identity matching
  const criticalFields = ['person_name', 'age', 'gender'];
  const optionalFields = ['contact', 'location_id']; // Less critical but can help confirm
  
  let matchCount = 0;
  let totalFields = 0;
  let matchDetails = {};
  
  // Check critical fields
  for (const field of criticalFields) {
    if (clientData[field] !== undefined && serverData[field] !== undefined) {
      totalFields++;
      
      if (field === 'person_name') {
        // Name comparison (case-insensitive, handle minor variations)
        const clientName = clientData[field].toLowerCase().trim();
        const serverName = serverData[field].toLowerCase().trim();
        
        // Check exact match or significant overlap
        const match = clientName === serverName || 
                     clientName.includes(serverName) || 
                     serverName.includes(clientName);
        matchDetails[field] = match;
        if (match) matchCount++;
      } else if (field === 'age') {
        // Age should match exactly or be within 1 year (account for birthday)
        const match = Math.abs(clientData[field] - serverData[field]) <= 1;
        matchDetails[field] = match;
        if (match) matchCount++;
      } else if (field === 'gender') {
        // Gender should match exactly
        const match = clientData[field].toLowerCase() === serverData[field].toLowerCase();
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
  
  // Consider it the same person if:
  // 1. Name and gender match AND (age matches OR contact matches)
  // 2. OR if 80% or more of available fields match
  const nameMatches = clientData.person_name && serverData.person_name && 
                     clientData.person_name.toLowerCase().trim() === serverData.person_name.toLowerCase().trim();
  const genderMatches = clientData.gender && serverData.gender &&
                       clientData.gender.toLowerCase() === serverData.gender.toLowerCase();
  const matchPercentage = totalFields > 0 ? (matchCount / totalFields) : 0;
  
  const isSamePerson = (nameMatches && genderMatches && matchCount >= 2) || matchPercentage >= 0.8;
  
  // Log the decision for debugging
  console.log(`🔍 Identity comparison for ${clientData.person_name}:`);
  console.log(`   - Match details:`, matchDetails);
  console.log(`   - Score: ${matchCount}/${totalFields} (${Math.round(matchPercentage * 100)}%)`);
  console.log(`   - Name matches: ${nameMatches}`);
  console.log(`   - Gender matches: ${genderMatches}`);
  console.log(`   - Decision: ${isSamePerson ? 'SAME PERSON' : 'DIFFERENT PERSON'}`);
  
  return isSamePerson;
}

// === Main Sync Logic, with allowed_strategies in all 409 responses ===
export const syncRegistrationFromClient = async (req, res) => {
  const r = req.body;

  if (!r.registration_id || !r.user_id || !r.person_name || !r.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate input data
  if (!isValidPersonName(r.person_name)) {
    return res.status(400).json({ error: 'Invalid person name format' });
  }
  if (r.age !== undefined && !isValidAge(r.age)) {
    return res.status(400).json({ error: 'Invalid age value' });
  }
  if (r.gender && !isValidGender(r.gender)) {
    return res.status(400).json({ error: 'Invalid gender value' });
  }

  try {
    const docRef = collection.doc(r.registration_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(r.updated_at);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'updated_at',
          latest_data: serverData,
          allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
        });
      }

      // Check for person identity changes that might conflict
      if (r.person_name !== serverData.person_name || 
          r.age !== serverData.age || 
          r.gender !== serverData.gender) {
        const identityCheck = await checkPersonIdentityExists(
          r.person_name, 
          r.age, 
          r.gender, 
          r.registration_id
        );
        
        if (identityCheck) {
          // Check if this is likely the same person (edge case: data correction)
          if (isSamePersonRegistration(r, identityCheck.data)) {
            console.log(`🔄 Auto-resolving: Same person detected for identity change ${r.person_name}`);
            
            // This might be a duplicate registration merge situation
            return res.status(409).json({
              error: 'Conflict: Person identity belongs to another registration that appears to be the same person',
              conflict_field: 'person_identity',
              conflict_type: 'potential_duplicate_registration',
              latest_data: identityCheck.data,
              allowed_strategies: ['client_wins', 'server_wins', 'merge'],
            });
          } else {
            // Different person with same identity
            return res.status(409).json({
              error: 'Conflict: Patient with the same name, age, and gender already exists',
              conflict_field: 'person_identity',
              conflict_type: 'unique_constraint',
              latest_data: identityCheck.data,
              allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
            });
          }
        }
      }

      // ✅ Safe to update
      await updateRegistrationDoc(r.registration_id, r);
    } else {
      // Create case - check for existing person
      const identityCheck = await checkPersonIdentityExists(r.person_name, r.age, r.gender);
      if (identityCheck) {
        // Check if this is likely the same person on a different device/session
        if (isSamePersonRegistration(r, identityCheck.data)) {
          console.log(`🔄 Auto-resolving: Same person detected for registration ${r.person_name}`);
          
          // Auto-resolve by updating the existing registration with new data
          // Use the server's registration_id but update with client data
          const mergedData = {
            ...identityCheck.data,
            ...r,
            registration_id: identityCheck.id, // Keep server's registration_id
            updated_at: new Date().toISOString(),
          };
          
          await updateRegistrationDoc(identityCheck.id, mergedData);
          
          return res.status(200).json({ 
            message: 'Registration synced successfully (auto-resolved duplicate registration)',
            resolved_as: 'same_person_detected',
            server_registration_id: identityCheck.id,
          });
        } else {
          // Different person with same identity - show conflict
          return res.status(409).json({
            error: 'Conflict: Patient with the same name, age, and gender already exists',
            conflict_field: 'person_identity',
            conflict_type: 'unique_constraint',
            latest_data: identityCheck.data,
            allowed_strategies: ['client_wins'],
          });
        }
      }

      // ✅ Safe to create new registration
      await createRegistrationDoc(r.registration_id, r);
    }

    return res.status(200).json({ message: 'Registration synced successfully' });
  } catch (err) {
    console.error('❌ Registration sync error:', err);
    return res.status(500).json({ error: 'Registration sync failed' });
  }
};

// === Improved Merge: Dynamic Field Coverage ===
export const resolveRegistrationConflict = (
  clientData,
  serverData,
  strategy = 'merge'
) => {
  switch (strategy) {
    case 'client_wins':
      // Client data takes precedence
      return { ...clientData };
      
    case 'server_wins':
      // Server data takes precedence
      return { ...serverData };

    case 'update_data':
      return {
        ...clientData,
        person_name: serverData.person_name,
        age: serverData.age,
        gender: serverData.gender,
        updated_at: new Date().toISOString(),
      };
      
    case 'merge':
    default: {
      // Intelligently merge data based on timestamps
      const clientUpdatedAt = clientData.updated_at ? new Date(clientData.updated_at) : null;
      const serverUpdatedAt = serverData.updated_at ? 
        (serverData.updated_at.toDate ? serverData.updated_at.toDate() : new Date(serverData.updated_at)) : 
        null;

      const merged = { ...serverData };
      const allKeys = [
        ...new Set([
          ...Object.keys(serverData),
          ...Object.keys(clientData),
        ]),
      ];
      const criticalFields = ['person_name', 'age', 'gender', 'status'];

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

      // Special handling for text fields that might need merging
      if (clientData.medical_history !== undefined || serverData.medical_history !== undefined) {
        merged.medical_history = mergeTextFields(clientData.medical_history, serverData.medical_history);
      }
      if (clientData.notes !== undefined || serverData.notes !== undefined) {
        merged.notes = mergeTextFields(clientData.notes, serverData.notes);
      }

      // Status field may have specific progression logic
      if (clientData.status !== undefined || serverData.status !== undefined) {
        merged.status = calculateMostAdvancedRegistrationStatus(clientData.status, serverData.status);
      }

      merged.updated_at =
        clientUpdatedAt && serverUpdatedAt && clientUpdatedAt > serverUpdatedAt
          ? clientData.updated_at
          : serverData.updated_at;
      return merged;
    }
  }
};

/**
 * Merges text fields intelligently
 * @param {string} clientText - Text from client
 * @param {string} serverText - Text from server
 * @returns {string} - Merged text
 */
const mergeTextFields = (clientText, serverText) => {
  // If either is undefined or null, return the other
  if (clientText === undefined || clientText === null) return serverText;
  if (serverText === undefined || serverText === null) return clientText;
  
  // If they're the same, return either
  if (clientText === serverText) return serverText;
  
  // If client text contains server text, client likely added to it
  if (clientText.includes(serverText)) return clientText;
  
  // If server text contains client text, server likely added to it
  if (serverText.includes(clientText)) return serverText;
  
  // Otherwise combine them with a separator
  return `${serverText}\n\n[SYNC MERGE] Client update:\n${clientText}`;
};

/**
 * Calculate most advanced registration status between client and server
 * @param {string} clientStatus - Status from client
 * @param {string} serverStatus - Status from server
 * @returns {string} - The most advanced status
 */
const calculateMostAdvancedRegistrationStatus = (clientStatus, serverStatus) => {
  const statusRank = {
    'pending': 1,
    'in_progress': 2,
    'completed': 3,
    'transferred': 4,
    'discharged': 5
  };
  
  // If either status is missing, return the other
  if (!clientStatus) return serverStatus;
  if (!serverStatus) return clientStatus;
  
  // Return the status with higher rank
  return statusRank[clientStatus] > statusRank[serverStatus] ? clientStatus : serverStatus;
};

// === Conflict Resolution Handler with allowed_strategies in response ===
export const resolveRegistrationSyncConflict = async (req, res) => {
  try {
    const { registration_id, resolution_strategy, clientData } = req.body;
    
    if (!registration_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Registration ID is required',
        status: 'error',
        allowed_strategies: [],
      });
    }
    
    const allowed_strategies = [];
    const docRef = collection.doc(registration_id);
    const doc = await docRef.get();
    
    let resolvedData;
    let isNewRegistration = false;
    
    if (!doc.exists) {
      isNewRegistration = true;
      allowed_strategies.push('client_wins');
      
      if (resolution_strategy === 'server_wins' || resolution_strategy === 'update_data') {
        return res.status(400).json({
          success: false,
          message: `Cannot use ${resolution_strategy} strategy for new registration - no server data exists`,
          status: 'error',
          allowed_strategies,
        });
      }
      
      // Validate unique constraints for new registration
      if (clientData.person_name && clientData.age !== undefined && clientData.gender) {
        const identityCheck = await checkPersonIdentityExists(
          clientData.person_name, 
          clientData.age, 
          clientData.gender, 
          registration_id
        );
        if (identityCheck) {
          return res.status(409).json({
            success: false,
            message: 'Cannot resolve conflict: Patient with the same identity already exists',
            status: 'error',
            conflict_field: 'person_identity',
            conflict_type: 'unique_constraint',
            latest_data: identityCheck.data,
            allowed_strategies,
          });
        }
      }
      
      resolvedData = { ...clientData };
    } else {
      allowed_strategies.push('client_wins', 'server_wins', 'merge', 'update_data');
      const serverData = doc.data();
      
      // For update_data, check constraints
      if (resolution_strategy === 'update_data') {
        if (clientData.person_name !== serverData.person_name || 
            clientData.age !== serverData.age || 
            clientData.gender !== serverData.gender) {
          const identityCheck = await checkPersonIdentityExists(
            clientData.person_name, 
            clientData.age, 
            clientData.gender, 
            registration_id
          );
          if (identityCheck) {
            return res.status(409).json({
              success: false,
              message: 'Cannot resolve conflict: Patient with the same identity already exists',
              status: 'error',
              conflict_field: 'person_identity',
              conflict_type: 'unique_constraint',
              latest_data: identityCheck.data,
              allowed_strategies,
            });
          }
        }
      }
      
      resolvedData = resolveRegistrationConflict(clientData, serverData, resolution_strategy);
    }
    
    if (isNewRegistration) {
      await createRegistrationDoc(registration_id, resolvedData);
    } else {
      await updateRegistrationDoc(registration_id, resolvedData);
    }
    
    return res.status(200).json({
      success: true,
      message: `Conflict resolved using ${resolution_strategy} strategy${isNewRegistration ? ' (new registration created)' : ' (existing registration updated)'}`,
      status: 'resolved',
      registration_id,
      resolvedData,
      isNewRegistration,
      resolution_strategy,
      allowed_strategies,
    });
  } catch (error) {
    console.error('Error resolving registration conflict:', error);
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      status: 'error',
      allowed_strategies: [],
    });
  }
};
