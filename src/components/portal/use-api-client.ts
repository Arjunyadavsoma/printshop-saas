'use client';

// Re-export from the new AuthContext-based implementation.
// The old useApiClient hook had per-instance state (caused the sign-in loop).
// The new version uses React Context → shared state → no loop.
export { useApiClient, AuthProvider } from './auth-context';
export type { AuthState, ApiResponse } from './auth-context';
