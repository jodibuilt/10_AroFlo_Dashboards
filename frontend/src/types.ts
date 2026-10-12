export type NavigationTab = 'reports' | 'tools';

export interface AuthUser {
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}
