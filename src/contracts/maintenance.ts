export const maintenanceCategories = ['painting','fridge','electricity','wifi','tv','garage','climate','water'] as const;
export type MaintenanceCategory = typeof maintenanceCategories[number];
export type MaintenanceStatus = 'ok' | 'attention' | 'not_applicable';
export type MaintenanceAnswer = {category:MaintenanceCategory;status:MaintenanceStatus;notes:string};
export type MaintenanceReport = MaintenanceAnswer & {reportedAt?:string};
export const maintenanceLabels:Record<MaintenanceCategory,string>={painting:'Painting',fridge:'Fridge',electricity:'Electricity',wifi:'Wi-Fi',tv:'TV',garage:'Garage',climate:'AC / heater',water:'Water'};
export const maintenanceStatuses:Record<MaintenanceStatus,string>={ok:'No issue',attention:'Needs attention',not_applicable:'Not applicable'};
