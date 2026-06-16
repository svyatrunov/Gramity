const assert = require('assert');
const { shouldPayout, resolvePayoutTarget, applyPercentRaw } = require('../dist/execution/payout.js');
let pass=0;
function t(name, fn){ fn(); pass++; console.log('  ok -', name); }
const ADDR='UQabc123def456';

// applyPercentRaw
t('percent 0 -> 0', ()=>assert.strictEqual(applyPercentRaw(1000n,0),0n));
t('percent 100 -> all', ()=>assert.strictEqual(applyPercentRaw(1000n,100),1000n));
t('percent 50 -> half', ()=>assert.strictEqual(applyPercentRaw(1000n,50),500n));
t('percent clamps >100', ()=>assert.strictEqual(applyPercentRaw(1000n,150),1000n));
t('percent clamps <0', ()=>assert.strictEqual(applyPercentRaw(1000n,-5),0n));
t('zero balance -> 0', ()=>assert.strictEqual(applyPercentRaw(0n,50),0n));

// resolvePayoutTarget
t('accumulate -> TON', ()=>assert.strictEqual(resolvePayoutTarget({strategy_mode:'accumulate'}).kind,'ton'));
t('stake_only -> tston', ()=>assert.strictEqual(resolvePayoutTarget({strategy_mode:'stake_only'}).kind,'tston'));
t('full -> lp', ()=>assert.strictEqual(resolvePayoutTarget({strategy_mode:'full'}).kind,'lp'));

// shouldPayout
const base={payout_enabled:true,payout_percent:50,payout_every_n_cycles:1,ton_address:ADDR};
t('every cycle fires', ()=>assert.strictEqual(shouldPayout(base,1),true));
t('disabled -> false', ()=>assert.strictEqual(shouldPayout({...base,payout_enabled:false},1),false));
t('0% -> false', ()=>assert.strictEqual(shouldPayout({...base,payout_percent:0},1),false));
t('no addr -> false', ()=>assert.strictEqual(shouldPayout({...base,ton_address:null},1),false));
t('every 4: cycle 3 no', ()=>assert.strictEqual(shouldPayout({...base,payout_every_n_cycles:4},3),false));
t('every 4: cycle 4 yes', ()=>assert.strictEqual(shouldPayout({...base,payout_every_n_cycles:4},4),true));
t('every 4: cycle 8 yes', ()=>assert.strictEqual(shouldPayout({...base,payout_every_n_cycles:4},8),true));
t('cycle 0 -> false', ()=>assert.strictEqual(shouldPayout(base,0),false));

console.log('\nALL '+pass+' PASSED');
