# IdeaVault Security Specification (Phase 0)

## 1. Data Invariants
1. Every `VaultItem` at `/users/{userId}/items/{itemId}` belongs exclusively to the verified user whose `request.auth.uid == userId` and `request.auth.token.email_verified == true`.
2. `id` must match `{itemId}` and follow `^[a-zA-Z0-9_\-]+$` with length `1..128`.
3. `ownerId` must equal `request.auth.uid` on create and remain immutable on update.
4. `createdAt` must equal `request.time` on create and remain immutable on update; `updatedAt` must equal `request.time` on create and update.
5. No unverified, anonymous, or cross-user reads (`get`/`list`) or writes (`create`/`update`/`delete`) are permitted.
6. Only allowlisted fields (`id`, `ownerId`, `category`, `subType`, `title`, `url`, `content`, `tags`, `favorite`, `createdAt`, `updatedAt`) may exist; shadow fields are rejected.
7. `tags` is strictly bounded to `<= 10` elements, and when non-empty, `tags[0] is string`.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated read/write**: Request with `request.auth == null` -> DENIED.
2. **Unverified email write/read**: Authenticated email/password user with `email_verified: false` -> DENIED.
3. **Cross-user get/list**: User B (`uid_B`) reading `/users/uid_A/items` -> DENIED.
4. **Identity spoofing on create**: User A creating `/users/uid_A/items/item-1` with `ownerId: "uid_B"` -> DENIED.
5. **Shadow/ghost field injection**: Payload containing extra key `isAdmin: true` -> DENIED.
6. **ID poisoning**: Document ID or `id` containing spaces/slashes or >128 chars -> DENIED.
7. **Timestamp forgery on create**: Client passing numeric or past `createdAt` instead of `request.time` -> DENIED.
8. **Immutable `createdAt`/`ownerId` tampering on update**: Updating `ownerId` or `createdAt` -> DENIED.
9. **Oversized title/content exhaustion**: `title.size() > 200` or `content.size() > 20000` -> DENIED.
10. **Invalid category enum**: `category: "admin_secret"` -> DENIED.
11. **Unbounded tags array / wrong element type**: `tags` with 11 items or `[123]` -> DENIED.
12. **Type poisoning on whitelisted update key**: Updating `favorite` to string `"true"` -> DENIED.
