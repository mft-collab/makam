import '@testing-library/jest-dom';

// Firebase modüllerini mock'la — testlerde gerçek bağlantı gerekmez
vi.mock('../firebase', () => ({
  db: {},
  auth: { currentUser: null },
  collection: vi.fn(),
  doc: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  writeBatch: vi.fn(() => ({
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(),
  })),
  runTransaction: vi.fn(),
  messaging: null,
}));

// localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Online/offline events
Object.defineProperty(window.navigator, 'onLine', { value: true, writable: true });

// window.dispatchEvent mock — sessizce geçelim
vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
