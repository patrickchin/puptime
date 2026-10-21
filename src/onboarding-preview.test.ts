import assert from 'node:assert/strict';
import test from 'node:test';
import {poopDelays,poopWindowsAfterMeals,starterMealTimes,suggestedMealCount} from './onboarding-preview.ts';

test('age guidance leaves unknown age open and offers the age-specific meal count',()=>{
  assert.equal(suggestedMealCount(null),null);
  assert.deepEqual(['young','middle','older','adult'].map(age=>suggestedMealCount(age as 'young'|'middle'|'older'|'adult')),[4,3,2,2]);
  assert.equal(starterMealTimes(4).length,4);
  assert.deepEqual(starterMealTimes(2),[420,1080]);
  const changed=starterMealTimes(3);changed[0]=480;
  assert.equal(starterMealTimes(3)[0],420);
  assert.throws(()=>starterMealTimes(0),RangeError);
});

test('owner-selected post-meal windows retain their full range, including midnight',()=>{
  assert.deepEqual(poopWindowsAfterMeals([420,1430],poopDelays[2]),[
    {minutes:465,toleranceMinutes:15},
    {minutes:35,toleranceMinutes:15},
  ]);
  assert.deepEqual(poopWindowsAfterMeals([420],poopDelays[0]),[{minutes:435,toleranceMinutes:15}]);
  assert.deepEqual(poopWindowsAfterMeals([],poopDelays[1]),[]);
});
