'use client';
/** Shared draft controls for listing defaults and a single cleaning. Saving is owned by the caller. */
export function CleaningCompensationFields({capacity,amount,onCapacityChange,onAmountChange,disabled=false,className}:{capacity:string;amount:string;onCapacityChange:(value:string)=>void;onAmountChange:(value:string)=>void;disabled?:boolean;className?:string}){
 return <div className={className}><label>Cleaners allowed per job<input type="number" min="1" max="20" step="1" disabled={disabled} value={capacity} onChange={event=>onCapacityChange(event.target.value)}/></label><label>Total cleaner compensation (USD)<input inputMode="decimal" disabled={disabled} value={amount} onChange={event=>onAmountChange(event.target.value)}/></label></div>;
}
