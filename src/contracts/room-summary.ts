export type RoomCompletionSummary = {
 rooms: {propertyId:string;identifier:string}[];
 spaces: {id:string;label:string;propertyId:string|null;scope:'room'|'shared'}[];
 items: {id:string;kind:'supply'|'maintenance';category:string;name:string;scope:'room'|'shared';propertyId:string|null;value:string|null;reportedAt:string|null;authorId:string|null}[];
};
/** Live maintenance issues for a room visit (comment + resolution), separate from the frozen completion snapshot. */
export type RoomIssues = {
 canResolve: boolean;
 issues: {itemId:string;notes:string|null;reportedAt:string;resolvedAt:string|null;resolvedByName:string|null}[];
};
