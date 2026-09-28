export const DEFAULT_AVATAR = '/icons/avatar-default.svg';
/** Clerk supplies a generated image URL even when no personal photo exists. */
export function profileAvatar(profile: {hasImage:boolean; imageUrl:string}):string {
 return profile.hasImage&&profile.imageUrl?profile.imageUrl:DEFAULT_AVATAR;
}
