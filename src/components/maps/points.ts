export type MapPoint={id:string;label:string;latitude:number;longitude:number};
export function validPin(pin:{latitude:number;longitude:number}){return Number.isFinite(pin.latitude)&&Number.isFinite(pin.longitude)&&Math.abs(pin.latitude)<=85.051129&&Math.abs(pin.longitude)<=180;}
export function groupPoints(points:MapPoint[]){const groups=new Map<string,MapPoint[]>();for(const point of points.filter(validPin)){const key=`${point.longitude},${point.latitude}`;groups.set(key,[...(groups.get(key)??[]),point]);}return [...groups.values()];}
