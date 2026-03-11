declare module 'virtual:user-pack-manifest' {
  export interface UserPackEntry {
    dir: string;
    file: string;
  }

  export const userPackBaseUrl: string | null;
  export const userPackEntries: UserPackEntry[];
}
