// General feeding guidance, not an individual feeding prescription:
// https://www.merckvetmanual.com/multimedia/table/feeding-schedule-for-puppies
export const puppyAges = [
  {id:'young',label:'6–12 weeks',meals:4},
  {id:'middle',label:'3–5 months',meals:3},
  {id:'older',label:'6–11 months',meals:2},
  {id:'adult',label:'A year or older',meals:2},
] as const;
export type PuppyAge = typeof puppyAges[number]['id'];

export function suggestedMealCount(age:PuppyAge|null):number|null {
  return puppyAges.find(item=>item.id===age)?.meals ?? null;
}

export function starterMealTimes(count:number):number[] {
  const times:Record<number,number[]>={1:[12*60],2:[7*60,18*60],3:[7*60,12*60,18*60],4:[7*60,11*60,15*60,19*60]};
  if(!times[count])throw new RangeError('Choose one to four meals.');
  return [...times[count]];
}

// Starting windows chosen during setup, not a prediction of a puppy's digestion.
export function starterPoopWindows(meals:readonly number[]) {
  return meals.map(minutes=>({minutes:(minutes+45)%1440,toleranceMinutes:15}));
}
