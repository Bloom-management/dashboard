const colors=['#cf7f8d','#b85563','#a99b72','#8e9583','#d4a391'];
export function ownerPropertyColor(id:string) {let hash=0;for(const char of id)hash=(hash*31+char.charCodeAt(0))>>>0;return colors[hash%colors.length];}
