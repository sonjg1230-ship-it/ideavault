# IdeaVault Security Specification (Phase 0 — Shared Google Allowlist)

## 1. Data Invariants
1. Every `SharedVault` at `/vaults/{vaultId}` is owned by the bootstrapped primary owner (`sonjg1230@gmail.com`, `email_verified == true`) and stores a strictly bounded `allowedEmails` list (size `1..3`), always containing `sonjg1230@gmail.com` at index `0`.
2. Every `VaultItem` at `/vaults/{vaultId}/items/{itemId}` belongs to an existing parent vault `/vaults/{vaultId}` and can only be read or written by a verified Google user (`request.auth.token.email_verified == true`) whose lowercase email is listed in `allowedEmails`.
3. `id` and `vaultId` must match `{itemId}` and `{vaultId}` respectively and follow `^[a-zA-Z0-9_\-]+$` (`1..128` chars).
4. `ownerId` must equal `request.auth.uid` on item creation and remain immutable on update.
5. `createdAt` must equal `request.time` on create and remain immutable on update; `updatedAt` must equal `request.time` on create and update.
6. `incoming().allowedEmails` on item creation and sync updates must match `get(/vaults/{vaultId}).data.allowedEmails`; non-admin members cannot alter `allowedEmails`.
7. No unauthenticated, unverified, or non-allowlisted user can read (`get`/`list`) or write (`create`/`update`/`delete`) `/vaults/{vaultId}` or `/vaults/{vaultId}/items/{itemId}`.
8. `allow list` on `/vaults/{vaultId}/items/{itemId}` enforces `request.auth.token.email.lower() in resource.data.allowedEmails` directly without `get()`/`exists()` calls, forcing client queries to use `where('allowedEmails', 'array-contains', userEmail)`.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated read/write**: Request with `request.auth == null` -> DENIED.
2. **Unverified email spoofing**: Auth token with `email: "sonjg1230@gmail.com"` and `email_verified: false` -> DENIED.
3. **Unauthorized Google account access**: Verified user `stranger@gmail.com` not in `/vaults/main.allowedEmails` reading or writing -> DENIED.
4. **Non-admin vault allowlist tampering**: Shared member (`mobile@gmail.com`) attempting to update `/vaults/main.allowedEmails` -> DENIED.
5. **Client-side allowlist smuggling on item create**: Member creating an item with extra email `attacker@gmail.com` in `allowedEmails` not matching parent `/vaults/main.allowedEmails` -> DENIED.
6. **Shadow/ghost field injection**: Payload containing extra key `isAdmin: true` -> DENIED.
7. **ID poisoning**: Document ID, `id`, or `vaultId` containing slashes/spaces or >128 chars -> DENIED.
8. **Identity spoofing on item create**: Member A creating item with `ownerId: "uid_B"` -> DENIED.
9. **Timestamp forgery & immutable tampering**: Client supplying numeric `createdAt` or modifying `ownerId`/`createdAt`/`vaultId` on update -> DENIED.
10. **Oversized strings / email exhaustion**: `title.size() > 200`, `content.size() > 20000`, or `allowedEmails.size() > 3` -> DENIED.
11. **Unbounded tags or wrong element type**: `tags` with 11 items or `[123]`, or `allowedEmails` with non-email / non-string entry -> DENIED.
12. **Type poisoning on whitelisted update key**: Updating `favorite` to string `"true"` -> DENIED.
