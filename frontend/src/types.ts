export type ReportTab = 'matrix' | 'analytics' | 'invoicing';
export type NavigationTab = ReportTab | 'tools';

export interface AuthUser {
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}
