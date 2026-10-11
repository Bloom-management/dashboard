export type SupplyPurchase={id:string;productName:string;productUrl:string|null;imageUrl:string|null;costCents:number;purchaseDate:string;restockedDate:string|null;createdAt:string;recordedBy:string};
export type SupplyPurchaseInput={productName:string;productUrl:string|null;imageUrl:string|null;costCents:number;purchaseDate:string;restockedDate:string|null};
export type SupplyPurchasePage={items:SupplyPurchase[];nextOffset:number|null};
