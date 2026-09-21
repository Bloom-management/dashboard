import type { JobPhoto, PhotoCategory, Role, SessionUser } from '../../contracts';

/** UI ports, NOT additional HTTP contracts. Main must implement these against approved DTOs.
 * No guessed routes or production fixtures are supplied for missing shared interfaces.
 */
export type AdminPerson = SessionUser & { email?: string | null; location?: string | null };
export type CityOption = { id: string; name: string; active: boolean };
export type PropertyOption = { id: string; name: string; cityId: string; timezone: string; address: string; isBloomOwned: boolean; active: boolean; ownerIds: string[]; pendingOwnerEmail?: string | null; instructions: string; soloRateCents: number };
export type SourceHealth = { id: string; propertyId: string; provider: 'airbnb' | 'vrbo'; enabled: boolean; lastSuccessAt: string | null; lastAttemptAt?: string | null; errorMessage: string | null };
export type CityRequest = { id: string; cleanerName: string; requestedCityName: string; status: 'pending' | 'approved' | 'rejected' };
export type Page<T> = { items: T[]; nextCursor: string | null };
export type UploadTicket = { photoId: string; upload: (file: File, onProgress: (percent: number) => void, signal: AbortSignal) => Promise<void> };
export interface BloomIntegration {
  /** Shared property name; server authorizes admins and linked owners. */
  renameProperty?: (propertyId: string, name: string, key: string) => Promise<{ id: string; name: string }>;
  listCities?: (signal: AbortSignal) => Promise<CityOption[]>;
  getMyCityRequest?: (signal: AbortSignal) => Promise<{ requestedCityName: string; status: 'pending' | 'approved' | 'rejected' } | null>;
  getInstructions?: (jobId: string, signal: AbortSignal, propertyId?: string) => Promise<{ instructions: string; address?: string }>;
  uploaderLabel?: (photo: JobPhoto) => string | undefined;
  prepareUpload?: (jobId: string, category: PhotoCategory, file: File, key: string, signal: AbortSignal, roomId?: string) => Promise<UploadTicket>;
  ownerProperties?: (signal: AbortSignal) => Promise<{ id: string; name: string }[]>;
  ownerFreshness?: (signal: AbortSignal) => Promise<{ propertyId: string; lastSuccessAt: string | null; message: string | null }[]>;
  accountControl?: (user: SessionUser) => import('react').ReactNode;
  admin?: {
    properties: (cursor: string | null, signal: AbortSignal) => Promise<Page<PropertyOption>>;
    users: (cursor: string | null, signal: AbortSignal) => Promise<Page<AdminPerson>>;
    cityRequests: (cursor: string | null, signal: AbortSignal) => Promise<Page<CityRequest>>;
    resolveCityRequest: (id: string, decision: 'approved' | 'rejected', key: string) => Promise<void>;
    sources: (cursor: string | null, signal: AbortSignal) => Promise<Page<SourceHealth>>;
    saveProperty?: (property: PropertyOption, key: string) => Promise<void>;
    property: (id: string, signal: AbortSignal) => Promise<PropertyOption>;
    propertySources: (id: string, cursor: string|null, signal: AbortSignal) => Promise<Page<SourceHealth>>;
    createProperty: (property: Omit<PropertyOption, 'id'>, key: string) => Promise<{id:string}>;
    saveCity?: (city: CityOption, key: string) => Promise<void>;
    createCity?: (city: Omit<CityOption, 'id'>, key: string) => Promise<void>;
    createJob?: (input: { propertyId: string; checkoutDate: string }, key: string) => Promise<void>;
    assignJob?: (jobId: string, input: { cleanerId: string; reason: string; expectedVersion: number }, key: string) => Promise<void>;
    assignments: (jobId: string, signal: AbortSignal) => Promise<{ id: string; cleanerName: string }[]>;
  };
}
export const rolePath: Record<Role, string> = { cleaner: '/cleaner', owner: '/owner', admin: '/admin' };
