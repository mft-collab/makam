import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  db
} from '../firebase';
import { runWithRetry } from '../lib/retry';
import { User, UserRole } from '../types';

export const userService = {
  async addUser(data: { email: string; fullName: string; role: UserRole; departmentId?: string }) {
    const emailId = data.email.toLowerCase().trim();
    const userRef = doc(db, 'users', emailId);
    await runWithRetry(async () => {
      await setDoc(userRef, {
        uid: emailId, // Temporary ID until they log in
        ...data,
        email: emailId
      });
    });
  },

  async updateUser(userId: string, data: Partial<User>) {
    await runWithRetry(async () => {
      await updateDoc(doc(db, 'users', userId), data);
    });
  },

  async deleteUser(userId: string) {
    await runWithRetry(async () => {
      await deleteDoc(doc(db, 'users', userId));
    });
  }
};
