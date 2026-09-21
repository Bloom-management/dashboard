import { maintenanceCategories, maintenanceStatuses, type MaintenanceAnswer, type MaintenanceCategory } from '../../contracts/maintenance';
import type { CompletionInput, SupplyLevel } from '../../contracts/index.ts';
export type JourneyDraft = { step: 'progress'|'photos'|'supplies'|'maintenance'; answers: Record<string, SupplyLevel>; maintenance?:Partial<Record<MaintenanceCategory,MaintenanceAnswer>>; notes: string; pending?: {key: string; input: CompletionInput}; version: number };
export const supplyLevels: Record<SupplyLevel, string> = {full:'Full',moderate:'Moderate',low:'Low',empty:'Empty',not_found:'Not found'};
export function completionInput(version: number, supplyIds: string[], answers: Record<string, SupplyLevel>, notes: string, maintenance?:Partial<Record<MaintenanceCategory,MaintenanceAnswer>>): CompletionInput | null {
  if (notes.length>1500 || supplyIds.some(id=>answers[id]!==undefined&&!Object.hasOwn(supplyLevels,answers[id]))) return null;
  if(maintenance && maintenanceCategories.some(category=>{const a=maintenance[category];return !!a&&(a.category!==category||!Object.hasOwn(maintenanceStatuses,a.status)||typeof a.notes!=='string'||a.notes.length>500||(a.status==='attention'&&!a.notes.trim()));}))return null;
  return {...(maintenance?{maintenance:maintenanceCategories.map(category=>maintenance[category]??{category,status:'not_applicable' as const,notes:''})}:{}),configVersion:version,answers:supplyIds.map(supplyId=>({supplyId,level:answers[supplyId]??'full'})),notes};
}
export function uncertainCompletion(code: string) {
  return !['VALIDATION_ERROR','PHOTO_COVERAGE_REQUIRED','CONFLICT','INVALID_STATE','REVIEW_REQUIRED','UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','CITY_MISMATCH'].includes(code);
}
