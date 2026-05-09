# Security Specification - Algodoneira Ops

## Data Invariants
1. A machine (`forklift`) cannot be operated without a valid assignment or event starting it.
2. Production data (`operational_events`) must always belong to a valid machine and be recorded by an authenticated leader.
3. Maintenance records must be created by operators/leaders and updated by mechanics/managers.
4. Inventory movements must always recorded with a user ID and timestamp.
5. Users can only modify their own profiles, but roles are immutable for the user.

## The Dirty Dozen Payloads (Attack Vectors)

1. **Role Escalation**: User `attacker` tries to update their own profile to `role: 'manager'`.
2. **Anonymous Write**: Attempting to add an `operational_event` without being logged in.
3. **Ghost Machine**: Creating an `operational_event` for a `forkliftId` that doesn't exist.
4. **Invalid Production**: Setting `production: -5000` or `production: "lots"`.
5. **Inventory Theft**: Deducting parts from `parts_inventory` with a negative change that bypasses inventory history.
6. **Machine Status Hijack**: An operator trying to set a machine to `available` when it should be `maintenance`.
7. **Terminal State Break**: Trying to update a `maintenance` record that is already `status: 'completed'`.
8. **PII Leak**: An operator trying to read someone else's email and phone from a `users` collection.
9. **Timestamp Spoofing**: Sending an event with `timestamp: "2020-01-01"` to mess up indicators.
10. **ID Poisoning**: Creating a checklist with an ID like `../../../etc/passwd`.
11. **Shadow Production**: Adding production to a `consolidation` event after it was already finalized.
12. **Relational Sync Bypass**: Closing a maintenance stop without adding it to the `operational_events` log.

## Verification
- All writes must be authenticated.
- Role-based access control (RBAC) must be strictly enforced.
- Input validation for types and sizes.
- Immutable fields (createdAt, role) must be protected on update.
