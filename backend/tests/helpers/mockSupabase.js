import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { __setMockClients, __resetMockClients } from '../../src/config/supabase.js';

/**
 * Creates an in-memory mock Supabase database client for testing:
 * users, profiles, households, household_members, inventory_items, waste_log, inventory_events,
 * devices, sensor_readings, device_events, notifications.
 */
export const createMockDatabaseClient = async (options = {}) => {
  const usersTable = new Map();
  const profilesTable = new Map();
  const householdsTable = new Map();
  const householdMembersTable = new Map();
  const inventoryItemsTable = new Map();
  const wasteLogTable = new Map();
  const inventoryEventsTable = new Map();
  const devicesTable = new Map();
  const sensorReadingsTable = new Map();
  const deviceEventsTable = new Map();
  const notificationsTable = new Map();
  const receiptsTable = new Map();
  const receiptItemsTable = new Map();
  const freshnessScansTable = new Map();
  const shoppingListTable = new Map();
  const avoidedWasteLogTable = new Map();
  const devicePairingTokensTable = new Map();

  // Pre-seed a known test user with properly hashed password
  const defaultPassword = options.defaultPassword || 'StrongPassword123!';
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);

  const defaultUser = {
    id: options.defaultUserId || '11111111-2222-3333-4444-555555555555',
    name: 'Test Chef',
    email: 'testuser@savebite.com',
    password_hash: hashedPassword,
    role: 'user',
    token_version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  usersTable.set(defaultUser.id, { ...defaultUser });

  // Pre-seed default household and membership for default user
  const defaultHousehold = {
    id: options.defaultHouseholdId || 'hhhhhhhh-1111-2222-3333-444444444444',
    name: "Test Chef's Household",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  householdsTable.set(defaultHousehold.id, { ...defaultHousehold });

  const defaultMembership = {
    id: 'mmmmmmmm-1111-2222-3333-444444444444',
    household_id: defaultHousehold.id,
    user_id: defaultUser.id,
    role: 'owner',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  householdMembersTable.set(defaultMembership.id, { ...defaultMembership });

  const getTableMap = (tableName) => {
    switch (tableName) {
      case 'users': return usersTable;
      case 'profiles': return profilesTable;
      case 'households': return householdsTable;
      case 'household_members': return householdMembersTable;
      case 'inventory_items': return inventoryItemsTable;
      case 'waste_log': return wasteLogTable;
      case 'inventory_events': return inventoryEventsTable;
      case 'devices': return devicesTable;
      case 'sensor_readings': return sensorReadingsTable;
      case 'device_events': return deviceEventsTable;
      case 'notifications': return notificationsTable;
      case 'receipts': return receiptsTable;
      case 'receipt_items': return receiptItemsTable;
      case 'freshness_scans': return freshnessScansTable;
      case 'shopping_list_items': return shoppingListTable;
      case 'avoided_waste_log':
      case 'avoided_waste_logs': return avoidedWasteLogTable;
      case 'device_pairing_tokens': return devicePairingTokensTable;
      default: return null;
    }
  };

  const client = {
    rpc: async (funcName, args) => {
      if (funcName === 'create_user_with_household') {
        const normalizedEmail = (args.p_email || '').trim().toLowerCase();
        for (const u of usersTable.values()) {
          if (u.email.toLowerCase() === normalizedEmail) {
            const duplicateErr = new Error('Email is already registered');
            duplicateErr.code = '23505';
            return { data: null, error: duplicateErr };
          }
        }

        const userId = crypto.randomUUID();
        const user = {
          id: userId,
          name: args.p_name.trim(),
          email: normalizedEmail,
          password_hash: args.p_password_hash,
          role: args.p_role || 'user',
          token_version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        usersTable.set(userId, user);

        const householdId = crypto.randomUUID();
        const household = {
          id: householdId,
          name: args.p_household_name || `${args.p_name}'s Household`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        householdsTable.set(householdId, household);

        const memberId = crypto.randomUUID();
        const member = {
          id: memberId,
          household_id: householdId,
          user_id: userId,
          role: 'owner',
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        householdMembersTable.set(memberId, member);

        return {
          data: {
            user,
            household: {
              ...household,
              role: 'owner',
              status: 'active'
            }
          },
          error: null
        };
      }
      return { data: null, error: new Error(`RPC ${funcName} not found`) };
    },

    from: (table) => {
      const targetMap = getTableMap(table);
      const filters = [];
      let sortField = null;
      let sortAsc = true;
      let rangeFrom = 0;
      let rangeTo = null;
      let limitCount = null;
      let insertRecords = null;
      let updatePayload = null;
      let isDelete = false;

      const filterPredicate = (record) => {
        for (const f of filters) {
          const val = record[f.col];
          if (f.op === 'eq') {
            if (f.val === null || f.val === undefined) {
              if (val !== null && val !== undefined) return false;
            } else if (String(val) !== String(f.val)) {
              return false;
            }
          }
          if (f.op === 'neq') {
            if (f.val === null || f.val === undefined) {
              if (val === null || val === undefined) return false;
            } else if (String(val) === String(f.val)) {
              return false;
            }
          }
          if (f.op === 'ilike' && (!val || !String(val).toLowerCase().includes(String(f.val).toLowerCase()))) return false;
          if (f.op === 'in' && (!Array.isArray(f.val) || !f.val.includes(val))) return false;
          if (f.op === 'gte' && !(val >= f.val)) return false;
          if (f.op === 'lte' && !(val <= f.val)) return false;
          if (f.op === 'gt' && !(val > f.val)) return false;
          if (f.op === 'lt' && !(val < f.val)) return false;
        }
        return true;
      };

      const enrichRecord = (record) => {
        if (!record) return null;
        const copy = { ...record };
        if (table === 'household_members') {
          const hh = householdsTable.get(copy.household_id);
          copy.households = hh ? { id: hh.id, name: hh.name } : null;
          const u = usersTable.get(copy.user_id);
          copy.users = u ? { id: u.id, name: u.name, email: u.email } : null;
        }
        return copy;
      };

      const builder = {
        select: (_fields, _options) => builder,
        eq: (col, val) => {
          filters.push({ op: 'eq', col, val });
          return builder;
        },
        neq: (col, val) => {
          filters.push({ op: 'neq', col, val });
          return builder;
        },
        ilike: (col, val) => {
          filters.push({ op: 'ilike', col, val });
          return builder;
        },
        in: (col, vals) => {
          filters.push({ op: 'in', col, val: vals });
          return builder;
        },
        gte: (col, val) => {
          filters.push({ op: 'gte', col, val });
          return builder;
        },
        lte: (col, val) => {
          filters.push({ op: 'lte', col, val });
          return builder;
        },
        gt: (col, val) => {
          filters.push({ op: 'gt', col, val });
          return builder;
        },
        lt: (col, val) => {
          filters.push({ op: 'lt', col, val });
          return builder;
        },
        order: (col, opts = {}) => {
          sortField = col;
          sortAsc = opts.ascending !== false;
          return builder;
        },
        range: (from, to) => {
          rangeFrom = from;
          rangeTo = to;
          return builder;
        },
        limit: (n) => {
          limitCount = n;
          return builder;
        },
        insert: (records) => {
          insertRecords = Array.isArray(records) ? records : [records];
          return builder;
        },
        update: (updates) => {
          updatePayload = updates;
          return builder;
        },
        delete: () => {
          isDelete = true;
          return builder;
        },
        maybeSingle: async () => {
          if (!targetMap) return { data: null, error: new Error(`Table ${table} not found`) };
          // If a sort order is specified, sort before picking the first matching element
          let matches = [];
          for (const item of targetMap.values()) {
            if (filterPredicate(item)) {
              matches.push(item);
            }
          }
          if (sortField) {
            matches.sort((a, b) => {
              const valA = a[sortField];
              const valB = b[sortField];
              if (valA === valB) return 0;
              if (valA === null || valA === undefined) return sortAsc ? 1 : -1;
              if (valB === null || valB === undefined) return sortAsc ? -1 : 1;
              return sortAsc ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
            });
          }
          if (matches.length > 0) {
            return { data: enrichRecord(matches[0]), error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (!targetMap) return { data: null, error: new Error(`Table ${table} not found`) };

          // Handle insert
          if (insertRecords && insertRecords.length > 0) {
            const raw = insertRecords[0];
            if (table === 'users') {
              const normalizedEmail = (raw.email || '').toLowerCase();
              for (const u of usersTable.values()) {
                if (u.email.toLowerCase() === normalizedEmail) {
                  const duplicateErr = new Error('duplicate key value violates unique constraint "idx_users_email_lower"');
                  duplicateErr.code = '23505';
                  return { data: null, error: duplicateErr };
                }
              }
            }
            if (table === 'household_members') {
              for (const m of householdMembersTable.values()) {
                if (m.household_id === raw.household_id && m.user_id === raw.user_id) {
                  const duplicateErr = new Error('duplicate key value violates unique constraint "uq_household_members_user_household"');
                  duplicateErr.code = '23505';
                  return { data: null, error: duplicateErr };
                }
              }
            }
            if (table === 'devices') {
              const normalizedCode = (raw.device_code || '').trim();
              for (const d of devicesTable.values()) {
                if (d.device_code === normalizedCode) {
                  const duplicateErr = new Error('duplicate key value violates unique constraint "idx_devices_device_code"');
                  duplicateErr.code = '23505';
                  return { data: null, error: duplicateErr };
                }
              }
            }
            const id = raw.id || crypto.randomUUID();
            const created = {
              ...raw,
              id,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            if (table === 'users') {
              created.email = created.email.toLowerCase();
              created.token_version = created.token_version || 1;
            }
            targetMap.set(id, created);
            return { data: enrichRecord(created), error: null };
          }

          // Handle update
          if (updatePayload) {
            for (const [id, item] of targetMap.entries()) {
              if (filterPredicate(item)) {
                const updated = {
                  ...item,
                  ...updatePayload,
                  updated_at: new Date().toISOString()
                };
                targetMap.set(id, updated);
                return { data: enrichRecord(updated), error: null };
              }
            }
            return { data: null, error: new Error('Record not found for update') };
          }

          // Handle select single
          for (const item of targetMap.values()) {
            if (filterPredicate(item)) {
              return { data: enrichRecord(item), error: null };
            }
          }
          return { data: null, error: new Error('Record not found') };
        },
        then: (resolve, reject) => {
          try {
            if (!targetMap) return resolve({ data: null, error: new Error(`Table ${table} not found`) });

            if (isDelete) {
              const deleted = [];
              for (const [id, item] of targetMap.entries()) {
                if (filterPredicate(item)) {
                  targetMap.delete(id);
                  deleted.push(item);
                }
              }
              return resolve({ data: deleted, error: null, count: deleted.length });
            }

            if (insertRecords) {
              const inserted = [];
              for (const raw of insertRecords) {
                const id = raw.id || crypto.randomUUID();
                const created = {
                  ...raw,
                  id,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                };
                targetMap.set(id, created);
                inserted.push(created);
              }
              return resolve({ data: inserted, error: null });
            }

            if (updatePayload) {
              const updatedList = [];
              for (const [id, item] of targetMap.entries()) {
                if (filterPredicate(item)) {
                  const updated = { ...item, ...updatePayload, updated_at: new Date().toISOString() };
                  targetMap.set(id, updated);
                  updatedList.push(updated);
                }
              }
              return resolve({ data: updatedList, error: null });
            }

            let results = [];
            for (const item of targetMap.values()) {
              if (filterPredicate(item)) {
                results.push(enrichRecord(item));
              }
            }

            if (sortField) {
              results.sort((a, b) => {
                const valA = a[sortField];
                const valB = b[sortField];
                if (valA === valB) return 0;
                if (valA === null || valA === undefined) return sortAsc ? 1 : -1;
                if (valB === null || valB === undefined) return sortAsc ? -1 : 1;
                return sortAsc ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
              });
            }

            const totalCount = results.length;

            if (rangeTo !== null) {
              results = results.slice(rangeFrom, rangeTo + 1);
            } else if (limitCount !== null) {
              results = results.slice(0, limitCount);
            }

            return resolve({ data: results, error: null, count: totalCount });
          } catch (err) {
            if (reject) return reject(err);
            return resolve({ data: null, error: err });
          }
        }
      };

      return builder;
    },
    storage: {
      from: (bucket) => ({
        upload: async (path, buffer, options) => {
          if (client.__storageFailUpload) {
            return { data: null, error: new Error('Simulated Supabase storage upload failure') };
          }
          return { data: { path: `${bucket}/${path}` }, error: null };
        },
        createSignedUrl: async (path, expiresIn) => {
          if (client.__storageFailSignUrl) {
            return { data: null, error: new Error('Simulated sign URL failure') };
          }
          return {
            data: {
              signedUrl: `https://test-project.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=mock-jwt-token`
            },
            error: null
          };
        }
      })
    }
  };

  return {
    client,
    usersTable,
    profilesTable,
    householdsTable,
    householdMembersTable,
    inventoryItemsTable,
    wasteLogTable,
    inventoryEventsTable,
    devicesTable,
    sensorReadingsTable,
    deviceEventsTable,
    notificationsTable,
    receiptsTable,
    receiptItemsTable,
    freshnessScansTable,
    shoppingListTable,
    avoidedWasteLogTable,
    devicePairingTokensTable,
    defaultUser,
    defaultHousehold,
    defaultMembership,
    defaultPassword
  };
};

export const setupTestDatabase = async (options = {}) => {
  const mock = await createMockDatabaseClient(options);
  __setMockClients({ client: mock.client, admin: mock.client });
  return mock;
};

export const teardownTestDatabase = () => {
  __resetMockClients();
};

export { __setMockClients, __resetMockClients };
