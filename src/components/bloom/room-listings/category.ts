/** Item categories are stored as e.g. "Bathroom stock"; show just the location ("Bathroom"). */
export const categoryLabel=(category:string)=>category.replace(/\s+stock$/i,'');
