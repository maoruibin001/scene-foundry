import {test,expect} from 'bun:test';
import {scoreComparison,scoreComparisonHTML} from '../public/score-comparison.js';
test('separate atomic aggregation from raw dimensions without modifying the formal verdict',()=>{
 const ids=['coverage','spatial','shape','material','readability'],j={status:'failed',quality:{score:90.3,dimensions:[28,32,12,20,8].map((weight,i)=>({id:ids[i],weight}))},review:{dimensions:[5,2.7,4,2,4].map((score,i)=>({id:ids[i],score}))}},before=JSON.stringify(j);
 expect(scoreComparison(j)).toEqual({formal:90.3,diagnostic:69.28,gap:21.02});expect(scoreComparisonHTML(j)).toContain('尚未通过');expect(JSON.stringify(j)).toBe(before);
 const invalid=structuredClone(j);invalid.review.dimensions[0].id='spatial';expect(scoreComparison(invalid)).toBeNull();
});
