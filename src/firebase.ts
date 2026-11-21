import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  collection,
  query,
  where,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const SHARED_VAULT_ID = 'main';
export const PRIMARY_OWNER_EMAIL = 'sonjg1230@gmail.com';

export const VALIDATION_LIMITS = {
  ID_MAX: 128,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  EMAIL_MAX: 128,
  EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  ALLOWED_EMAILS_MAX: 3,
  SUBTYPE_MAX: 64,
  TITLE_MIN: 1,
  TITLE_MAX: 200,
  URL_MAX: 2000,
  URL_PATTERN: /^https?:\/\/.*/,
  CONTENT_MAX: 20000,
  TAGS_MAX_COUNT: 10,
  TAG_MAX_LEN: 40,
} as const;

export type VaultCategory = 'idea' | 'creation' | 'reference';

export interface SharedVault {
  id: string;
  ownerId: string;
  ownerEmail: string;
  allowedEmails: string[];
  createdAt: Timestamp | number;
  updatedAt?: Timestamp | number;
}

export interface VaultItem {
  id: string;
  vaultId: string;
  ownerId: string;
  allowedEmails: string[];
  category: VaultCategory;
  subType: string;
  title: string;
  url: string;
  content: string;
  tags: string[];
  favorite: boolean;
  createdAt: Timestamp | number;
  updatedAt?: Timestamp | number;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export function sanitizeId(rawId?: string): string {
  const cleaned = (rawId || `item-${Date.now()}`)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, VALIDATION_LIMITS.ID_MAX);
  if (!cleaned || !VALIDATION_LIMITS.ID_PATTERN.test(cleaned)) {
    return `item-${Date.now()}`;
  }
  return cleaned;
}

export function sanitizeCategory(raw?: string): VaultCategory {
  if (raw === 'creation' || raw === 'reference' || raw === 'idea') {
    return raw;
  }
  return 'idea';
}

export function sanitizeUrl(raw?: string): string {
  const trimmed = (raw || '').trim().slice(0, VALIDATION_LIMITS.URL_MAX);
  if (!trimmed) return '';
  if (VALIDATION_LIMITS.URL_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return '';
}

export function sanitizeTags(rawTags: unknown): string[] {
  if (!Array.isArray(rawTags)) return [];
  const result: string[] = [];
  for (const t of rawTags) {
    if (typeof t !== 'string') continue;
    const cleaned = t.trim().replace(/^#/, '').slice(0, VALIDATION_LIMITS.TAG_MAX_LEN);
    if (cleaned && !result.includes(cleaned)) {
      result.push(cleaned);
    }
    if (result.length >= VALIDATION_LIMITS.TAGS_MAX_COUNT) break;
  }
  return result;
}

export function normalizeAllowedEmails(extraEmails: string[] = []): string[] {
  const list: string[] = [PRIMARY_OWNER_EMAIL];
  for (const raw of extraEmails) {
    if (typeof raw !== 'string') continue;
    const email = raw.trim().toLowerCase().slice(0, VALIDATION_LIMITS.EMAIL_MAX);
    if (
      email &&
      VALIDATION_LIMITS.EMAIL_PATTERN.test(email) &&
      !list.includes(email)
    ) {
      list.push(email);
    }
    if (list.length >= VALIDATION_LIMITS.ALLOWED_EMAILS_MAX) break;
  }
  return list;
}

export function isPrimaryAdminUser(user: User | null): boolean {
  return Boolean(
    user &&
      user.emailVerified &&
      user.email &&
      user.email.toLowerCase() === PRIMARY_OWNER_EMAIL
  );
}

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function loadOrInitSharedVault(user: User): Promise<SharedVault> {
  const vaultPath = `vaults/${SHARED_VAULT_ID}`;
  const vaultRef = doc(db, 'vaults', SHARED_VAULT_ID);
  const userEmail = (user.email || '').toLowerCase();

  let snap;
  try {
    snap = await getDoc(vaultRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, vaultPath);
  }

  if (snap.exists()) {
    const data = snap.data() as SharedVault;
    const allowed = Array.isArray(data.allowedEmails)
      ? data.allowedEmails.map((e) => e.toLowerCase())
      : [];
    if (!allowed.includes(userEmail) && userEmail !== PRIMARY_OWNER_EMAIL) {
      throw new Error('VAULT_ACCESS_DENIED');
    }
    return {
      ...data,
      allowedEmails: allowed,
    };
  }

  if (userEmail !== PRIMARY_OWNER_EMAIL) {
    throw new Error('VAULT_NOT_INITIALIZED');
  }

  const initialVault = {
    id: SHARED_VAULT_ID,
    ownerId: user.uid,
    ownerEmail: PRIMARY_OWNER_EMAIL,
    allowedEmails: [PRIMARY_OWNER_EMAIL],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(vaultRef, initialVault);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, vaultPath);
  }

  return {
    id: SHARED_VAULT_ID,
    ownerId: user.uid,
    ownerEmail: PRIMARY_OWNER_EMAIL,
    allowedEmails: [PRIMARY_OWNER_EMAIL],
    createdAt: Date.now(),
  };
}

export function subscribeSharedVault(
  onUpdate: (vault: SharedVault | null) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const vaultPath = `vaults/${SHARED_VAULT_ID}`;
  const vaultRef = doc(db, 'vaults', SHARED_VAULT_ID);

  return onSnapshot(
    vaultRef,
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate(snap.data() as SharedVault);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, vaultPath);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function updateVaultAllowedEmails(
  user: User,
  extraEmails: string[]
): Promise<string[]> {
  if (!isPrimaryAdminUser(user)) {
    throw new Error('공유 계정 목록은 관리자 계정만 변경할 수 있습니다.');
  }

  const nextAllowedEmails = normalizeAllowedEmails(extraEmails);
  const vaultPath = `vaults/${SHARED_VAULT_ID}`;
  const vaultRef = doc(db, 'vaults', SHARED_VAULT_ID);

  try {
    await updateDoc(vaultRef, {
      allowedEmails: nextAllowedEmails,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, vaultPath);
  }

  // 기존 항목들의 allowedEmails도 새 공유 목록과 동기화
  const itemsColPath = `vaults/${SHARED_VAULT_ID}/items`;
  try {
    const q = query(
      collection(db, 'vaults', SHARED_VAULT_ID, 'items'),
      where('allowedEmails', 'array-contains', PRIMARY_OWNER_EMAIL)
    );
    const snapshot = await getDocs(q);
    const docsToUpdate = snapshot.docs.filter((docSnap) => {
      const currentList = docSnap.data()?.allowedEmails;
      return JSON.stringify(currentList) !== JSON.stringify(nextAllowedEmails);
    });

    for (let i = 0; i < docsToUpdate.length; i += 400) {
      const chunk = docsToUpdate.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const docSnap of chunk) {
        batch.update(docSnap.ref, {
          allowedEmails: nextAllowedEmails,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, itemsColPath);
  }

  return nextAllowedEmails;
}

export function subscribeVaultItems(
  userEmail: string,
  onData: (items: VaultItem[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const itemsPath = `vaults/${SHARED_VAULT_ID}/items`;
  const normalizedEmail = userEmail.trim().toLowerCase();
  const q = query(
    collection(db, 'vaults', SHARED_VAULT_ID, 'items'),
    where('allowedEmails', 'array-contains', normalizedEmail)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const loaded: VaultItem[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        loaded.push({
          ...(data as VaultItem),
          id: docSnap.id,
        });
      });
      onData(loaded);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, itemsPath);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function createVaultItem(
  userId: string,
  allowedEmails: string[],
  draft: {
    id?: string;
    category: string;
    subType?: string;
    title: string;
    url?: string;
    content?: string;
    tags?: string[];
    favorite?: boolean;
  }
): Promise<string> {
  const itemId = sanitizeId(draft.id);
  const path = `vaults/${SHARED_VAULT_ID}/items/${itemId}`;
  const title = (draft.title || '').trim().slice(0, VALIDATION_LIMITS.TITLE_MAX);
  if (!title) {
    throw new Error('제목을 입력해 주세요.');
  }

  const normalizedAllowed = normalizeAllowedEmails(allowedEmails);

  const payload = {
    id: itemId,
    vaultId: SHARED_VAULT_ID,
    ownerId: userId,
    allowedEmails: normalizedAllowed,
    category: sanitizeCategory(draft.category),
    subType: (draft.subType || '메모').trim().slice(0, VALIDATION_LIMITS.SUBTYPE_MAX),
    title,
    url: sanitizeUrl(draft.url),
    content: (draft.content || '').slice(0, VALIDATION_LIMITS.CONTENT_MAX),
    tags: sanitizeTags(draft.tags),
    favorite: Boolean(draft.favorite),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'vaults', SHARED_VAULT_ID, 'items', itemId), payload);
    return itemId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateVaultItem(
  itemId: string,
  partial: Partial<{
    category: string;
    subType: string;
    title: string;
    url: string;
    content: string;
    tags: string[];
    favorite: boolean;
  }>
): Promise<void> {
  const path = `vaults/${SHARED_VAULT_ID}/items/${itemId}`;
  const updatePayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (partial.category !== undefined) {
    updatePayload.category = sanitizeCategory(partial.category);
  }
  if (partial.subType !== undefined) {
    updatePayload.subType = partial.subType.trim().slice(0, VALIDATION_LIMITS.SUBTYPE_MAX);
  }
  if (partial.title !== undefined) {
    const trimmedTitle = partial.title.trim().slice(0, VALIDATION_LIMITS.TITLE_MAX);
    if (!trimmedTitle) throw new Error('제목은 비워둘 수 없습니다.');
    updatePayload.title = trimmedTitle;
  }
  if (partial.url !== undefined) {
    updatePayload.url = sanitizeUrl(partial.url);
  }
  if (partial.content !== undefined) {
    updatePayload.content = partial.content.slice(0, VALIDATION_LIMITS.CONTENT_MAX);
  }
  if (partial.tags !== undefined) {
    updatePayload.tags = sanitizeTags(partial.tags);
  }
  if (partial.favorite !== undefined) {
    updatePayload.favorite = Boolean(partial.favorite);
  }

  try {
    await updateDoc(doc(db, 'vaults', SHARED_VAULT_ID, 'items', itemId), updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteVaultItem(itemId: string): Promise<void> {
  const path = `vaults/${SHARED_VAULT_ID}/items/${itemId}`;
  try {
    await deleteDoc(doc(db, 'vaults', SHARED_VAULT_ID, 'items', itemId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function getAuthErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  switch (code) {
    case 'auth/popup-closed-by-user':
      return '로그인 창이 닫혔습니다. 다시 시도해 주세요.';
    case 'auth/popup-blocked':
      return '브라우저에서 팝업이 차단되었습니다. 팝업 허용 후 다시 시도해 주세요.';
    case 'auth/cancelled-popup-request':
      return '이미 로그인 창이 열려 있습니다.';
    case 'auth/unauthorized-domain':
      return '현재 도메인이 Firebase 승인된 도메인에 등록되어 있지 않습니다.';
    case 'auth/network-request-failed':
      return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
    case 'auth/too-many-requests':
      return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    default:
      return error instanceof Error ? error.message : 'Google 로그인 중 오류가 발생했습니다.';
  }
}

export {
  firebaseConfig,
  onAuthStateChanged,
  signOut,
  type User,
};
