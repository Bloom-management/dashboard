'use client';
import {useUser} from '@clerk/nextjs';
/** Replace Clerk's generated avatar only; uploaded profile images retain their source. */
export function AvatarDefaults(){
 const {user}=useUser();
 if(!user||user.hasImage||!user.imageUrl)return null;
 const source=user.imageUrl.split('?')[0];
 return <style>{`img[src^=${JSON.stringify(source)}]{content:url("/icons/avatar-default.svg");background:#d8c3ab;border-radius:50%;}`}</style>;
}
