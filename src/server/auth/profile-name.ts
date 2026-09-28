/** Names are supplied by a profile or its authenticated owner, never inferred from email. */
export function profileName(value: unknown): string | null {
 if(typeof value!=='string'||value.length>100||/[\p{Cc}\p{Cf}]/u.test(value))return null;
 const name=value.trim().replace(/\s+/gu,' ');
 return name&&name.toLowerCase()!=='account'?name:null;
}
