import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, advanceOrder, canViewOrder } from '../frontend/modules/workflow.js';

test('业务单阶段按顺序推进，同一单号保留轨迹，未生成 Word 禁止送审',()=>{
  const quote=createOrder([],{owner:'a',stage:'quote'});
  assert.throws(()=>advanceOrder(quote,'review'));
  const form=advanceOrder(quote,'form');
  assert.throws(()=>advanceOrder(form,'review'),/生成 Word/);
  const review=advanceOrder({...form,formRecord:'record-1'},'review');
  assert.equal(review.id,quote.id);
  assert.deepEqual(review.events.map(e=>e.stage),['quote','form','review']);
  assert.equal(advanceOrder(review,'review'),review);
  assert.notEqual(createOrder([review],{owner:'a',stage:'form'}).id,review.id);
  assert.equal(canViewOrder(review,{id:'a',role:'staff'}),true);
  assert.equal(canViewOrder(review,{id:'b',role:'staff'}),false);
  assert.equal(canViewOrder(review,{id:'admin',role:'admin'}),true);
});
