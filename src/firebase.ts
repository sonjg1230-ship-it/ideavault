import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  collection,
  query,
  where,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const VALIDATION_LIMITS = {
  ID_MAX: 128,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
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

export interface VaultItem {
  id: string;
  ownerId: string;
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
  const cleaned = (rawId || `item-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, VALIDATION_LIMITS.ID_MAX);
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

export function subscribeVaultItems(
  userId: string,
  onData: (items: VaultItem[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const itemsPath = `users/${userId}/items`;
  const q = query(collection(db, 'users', userId, 'items'), where('ownerId', '==', userId));

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
  const path = `users/${userId}/items/${itemId}`;
  const title = (draft.title || '').trim().slice(0, VALIDATION_LIMITS.TITLE_MAX);
  if (!title) {
    throw new Error('제목을 입력해 주세요.');
  }

  const payload = {
    id: itemId,
    ownerId: userId,
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
    await setDoc(doc(db, 'users', userId, 'items', itemId), payload);
    return itemId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateVaultItem(
  userId: string,
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
  const path = `users/${userId}/items/${itemId}`;
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
    await updateDoc(doc(db, 'users', userId, 'items', itemId), updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteVaultItem(userId: string, itemId: string): Promise<void> {
  const path = `users/${userId}/items/${itemId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'items', itemId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function getAuthErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-email':
      return '올바른 이메일 형식을 입력해 주세요.';
    case 'auth/user-disabled':
      return '비활성화된 계정입니다.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return '이메일 또는 비밀번호가 올바르지 않습니다.';
    case 'auth/email-already-in-use':
      return '이미 가입된 이메일입니다. 로그인 탭에서 로그인해 주세요.';
    case 'auth/weak-password':
      return '비밀번호는 6자 이상으로 입력해 주세요.';
    case 'auth/too-many-requests':
      return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    case 'auth/operation-not-allowed':
      return 'Firebase 콘솔에서 이메일/비밀번호 로그인을 먼저 활성화해야 합니다.';
    default:
      return error instanceof Error ? error.message : '인증 중 오류가 발생했습니다.';
  }
}

export {
  firebaseConfig,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  type User,
};
