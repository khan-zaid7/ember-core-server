import { createLocationDoc, updateLocationDoc } from '../../models/locationModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const col = db.collection('locations');

// === Input Validators ===
function isValidLocationName(name) {
  return typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 100;
}

function isValidCoordinates(latitude, longitude) {
  if (latitude === undefined && longitude === undefined) return true; // Optional fields
  if (latitude === undefined || longitude === undefined) return false; // Both required if one is provided
  
  return typeof latitude === 'number' && 
         typeof longitude === 'number' &&
         latitude >= -90 && latitude <= 90 &&
         longitude >= -180 && longitude <= 180;
}

function isValidLocationType(type) {
  const validTypes = ['hospital', 'clinic', 'pharmacy', 'laboratory', 'emergency', 'other'];
  return !type || (typeof type === 'string' && validTypes.includes(type.toLowerCase()));
}

/**
 * Checks if a location with the same name already exists
 * @param {string} name - The location name
 * @param {string} [currentLocationId=null] - The current location ID (to exclude from check)
 * @returns {Promise<Object|null>}
 */
async function checkLocationNameExists(name, currentLocationId = null) {
  if (!name) return null;
  
  const snapshot = await col.where('name', '==', name).get();
  if (snapshot.empty) return null;
  
  if (snapshot.size > 1) {
    console.warn(
      `⚠️ Multiple locations found with name "${name}". Data may be corrupted!`
    );
  }
  
  const firstOtherDoc = snapshot.docs.find(
    (doc) => !currentLocationId || doc.id !== currentLocationId
  );
  
  if (!firstOtherDoc) return null;
  
  return {
    exists: true,
    data: firstOtherDoc.data(),
    id: firstOtherDoc.id,
  };
}

/**
 * Checks if two locations are likely the same place based on matching data
 * @param {Object} clientData - The client location data
 * @param {Object} serverData - The server location data
 * @returns {boolean} - True if locations likely refer to same place
 */
function isSameLocationPlace(clientData, serverData) {
  // Define fields to compare for identity matching
  const criticalFields = ['name', 'address'];
  const optionalFields = ['type', 'latitude', 'longitude']; // Less critical but can help confirm
  
  let matchCount = 0;
  let totalFields = 0;
  let matchDetails = {};
  
  // Check critical fields
  for (const field of criticalFields) {
    if (clientData[field] && serverData[field]) {
      totalFields++;
      
      if (field === 'name') {
        // Name comparison (case-insensitive, handle minor variations)
        const clientName = clientData[field].toLowerCase().trim();
        const serverName = serverData[field].toLowerCase().trim();
        
        // Check exact match or significant overlap
        const match = clientName === serverName || 
                     clientName.includes(serverName) || 
                     serverName.includes(clientName);
        matchDetails[field] = match;
        if (match) matchCount++;
      } else if (field === 'address') {
        // Address comparison (case-insensitive, handle minor variations)
        const clientAddress = clientData[field].toLowerCase().trim();
        const serverAddress = serverData[field].toLowerCase().trim();
        
        // Check exact match or significant overlap
        const match = clientAddress === serverAddress || 
                     clientAddress.includes(serverAddress) || 
                     serverAddress.includes(clientAddress);
        matchDetails[field] = match;
        if (match) matchCount++;
      }
    }
  }
  
  // Check optional fields for additional confirmation
  for (const field of optionalFields) {
    if (clientData[field] && serverData[field]) {
      totalFields++;
      
      if (field === 'latitude' || field === 'longitude') {
        // Coordinate comparison (within reasonable distance ~100m)
        const match = Math.abs(clientData[field] - serverData[field]) <= 0.001;
        matchDetails[field] = match;
        if (match) matchCount++;
      } else {
        // Type comparison
        const match = clientData[field].toLowerCase() === serverData[field].toLowerCase();
        matchDetails[field] = match;
        if (match) matchCount++;
      }
    }
  }
  
  // Consider it the same location if:
  // 1. Name matches AND (address matches OR coordinates are close)
  // 2. OR if 80% or more of available fields match
  const nameMatches = clientData.name && serverData.name && 
                     clientData.name.toLowerCase().trim() === serverData.name.toLowerCase().trim();
  const addressMatches = clientData.address && serverData.address &&
                        clientData.address.toLowerCase().trim() === serverData.address.toLowerCase().trim();
  const matchPercentage = totalFields > 0 ? (matchCount / totalFields) : 0;
  
  const isSamePlace = (nameMatches && (addressMatches || matchCount >= 2)) || matchPercentage >= 0.8;
  
  // Log the decision for debugging
  console.log(`🔍 Location identity comparison for ${clientData.name}:`);
  console.log(`   - Match details:`, matchDetails);
  console.log(`   - Score: ${matchCount}/${totalFields} (${Math.round(matchPercentage * 100)}%)`);
  console.log(`   - Name matches: ${nameMatches}`);
  console.log(`   - Address matches: ${addressMatches}`);
  console.log(`   - Decision: ${isSamePlace ? 'SAME LOCATION' : 'DIFFERENT LOCATION'}`);
  
  return isSamePlace;
}

// === Main Sync Logic, with allowed_strategies in all 409 responses ===
export const syncLocationFromClient = async (req, res) => {
  const l = req.body;

  if (!l.location_id || !l.user_id || !l.name || !l.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate input data
  if (!isValidLocationName(l.name)) {
    return res.status(400).json({ error: 'Invalid location name format' });
  }
  if (!isValidCoordinates(l.latitude, l.longitude)) {
    return res.status(400).json({ error: 'Invalid coordinates - both latitude and longitude must be provided together' });
  }
  if (!isValidLocationType(l.type)) {
    return res.status(400).json({ error: 'Invalid location type' });
  }

  try {
    const docRef = col.doc(l.location_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(l.updated_at);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'updated_at',
          latest_data: serverData,
          allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
          client_id: l.location_id,
          server_id: l.location_id, // Same ID for stale updates
        });
      }

      // Check for location name changes that might conflict
      if (l.name !== serverData.name) {
        const nameCheck = await checkLocationNameExists(l.name, l.location_id);
        
        if (nameCheck) {
          // Check if this is likely the same location (edge case: name correction)
          if (isSameLocationPlace(l, nameCheck.data)) {
            console.log(`🔄 Auto-resolving: Same location detected for name change ${l.name}`);
            
            // This might be a duplicate location merge situation
            return res.status(409).json({
              error: 'Conflict: Location name belongs to another location that appears to be the same place',
              conflict_field: 'name',
              conflict_type: 'potential_duplicate_location',
              latest_data: nameCheck.data,
              allowed_strategies: ['client_wins', 'server_wins', 'merge'],
              client_id: l.location_id,
              server_id: nameCheck.id,
            });
          } else {
            // Different location with same name
            return res.status(409).json({
              error: 'Conflict: Location with this name already exists',
              conflict_field: 'name',
              conflict_type: 'unique_constraint',
              latest_data: nameCheck.data,
              allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
            });
          }
        }
      }

      // ✅ Safe to update
      await updateLocationDoc(l.location_id, l);
    } else {
      // Create case - check for existing location name
      const nameCheck = await checkLocationNameExists(l.name);
      if (nameCheck) {
        // Check if this is likely the same location on a different device/session
        if (isSameLocationPlace(l, nameCheck.data)) {
          console.log(`🔄 Auto-resolving: Same location detected for ${l.name}`);
          
          // Auto-resolve by updating the existing location with new data
          // Use the server's location_id but update with client data
          const mergedData = {
            ...nameCheck.data,
            ...l,
            location_id: nameCheck.id, // Keep server's location_id
            updated_at: new Date().toISOString(),
          };
          
          await updateLocationDoc(nameCheck.id, mergedData);
          
          return res.status(200).json({ 
            message: 'Location synced successfully (auto-resolved duplicate location)',
            resolved_as: 'same_location_detected',
            server_location_id: nameCheck.id,
          });
        } else {
          // Different location with same name - show conflict
          return res.status(409).json({
            error: 'Conflict: Location with this name already exists',
            conflict_field: 'name',
            conflict_type: 'unique_constraint',
            latest_data: nameCheck.data,
            allowed_strategies: ['client_wins'],
          });
        }
      }

      // ✅ Safe to create new location
      await createLocationDoc(l.location_id, l);
    }

    return res.status(200).json({ message: 'Location synced successfully' });
  } catch (err) {
    console.error('❌ Location sync error:', err);
    return res.status(500).json({ error: 'Location sync failed' });
  }
};

// === Improved Merge: Dynamic Field Coverage ===
export const resolveLocationConflict = (
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
        name: serverData.name,
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
      const criticalFields = ['name', 'type'];

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
export const resolveLocationSyncConflict = async (req, res) => {
  try {
    const { location_id, resolution_strategy, clientData } = req.body;
    
    if (!location_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Location ID is required',
        status: 'error',
        allowed_strategies: [],
      });
    }
    
    const allowed_strategies = [];
    const docRef = col.doc(location_id);
    const doc = await docRef.get();
    
    let resolvedData;
    let isNewLocation = false;
    
    if (!doc.exists) {
      isNewLocation = true;
      allowed_strategies.push('client_wins');
      
      if (resolution_strategy === 'server_wins' || resolution_strategy === 'update_data') {
        return res.status(400).json({
          success: false,
          message: `Cannot use ${resolution_strategy} strategy for new location - no server data exists`,
          status: 'error',
          allowed_strategies,
        });
      }
      
      // Validate unique constraints for new location
      if (clientData.name) {
        const nameCheck = await checkLocationNameExists(clientData.name, location_id);
        if (nameCheck) {
          return res.status(409).json({
            success: false,
            message: 'Cannot resolve conflict: Location with this name already exists',
            status: 'error',
            conflict_field: 'name',
            conflict_type: 'unique_constraint',
            latest_data: nameCheck.data,
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
        if (clientData.name !== serverData.name) {
          const nameCheck = await checkLocationNameExists(clientData.name, location_id);
          if (nameCheck) {
            return res.status(409).json({
              success: false,
              message: 'Cannot resolve conflict: Location with this name already exists',
              status: 'error',
              conflict_field: 'name',
              conflict_type: 'unique_constraint',
              latest_data: nameCheck.data,
              allowed_strategies,
            });
          }
        }
      }
      
      resolvedData = resolveLocationConflict(clientData, serverData, resolution_strategy);
    }
    
    if (isNewLocation) {
      await createLocationDoc(location_id, resolvedData);
    } else {
      await updateLocationDoc(location_id, resolvedData);
    }
    
    return res.status(200).json({
      success: true,
      message: `Conflict resolved using ${resolution_strategy} strategy${isNewLocation ? ' (new location created)' : ' (existing location updated)'}`,
      status: 'resolved',
      location_id,
      resolvedData,
      isNewLocation,
      resolution_strategy,
      allowed_strategies,
      client_id: location_id,
      server_id: location_id, // For locations, IDs should match after resolution
    });
  } catch (error) {
    console.error('Error resolving location conflict:', error);
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      status: 'error',
      allowed_strategies: [],
    });
  }
};
