import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
let environment!: RulesTestEnvironment;
async function setup() {
  environment ??= await initializeTestEnvironment({ projectId: 'demo-huroof-wa-oloof', firestore: { host: host.split(':')[0], port: Number(host.split(':')[1]), rules: await (await import('node:fs/promises')).readFile('firestore.rules', 'utf8') } });
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'rooms/r1/members/u1'), { uid: 'u1', role: 'player', active: true });
    await setDoc(doc(context.firestore(), 'rooms/r1/members/u2'), { uid: 'u2', role: 'player', active: true });
    await setDoc(doc(context.firestore(), 'rooms/r1/members/u3'), { uid: 'u3', role: 'host', active: true });
    await setDoc(doc(context.firestore(), 'rooms/r1/members/u4'), { uid: 'u4', role: 'player', active: false });
    await setDoc(doc(context.firestore(), 'rooms/r1/projections/player_u1'), { revision: 1 });
    await setDoc(doc(context.firestore(), 'rooms/r1/projections/player_u2'), { revision: 1 });
    await setDoc(doc(context.firestore(), 'rooms/r1/projections/audience'), { revision: 1 });
    await setDoc(doc(context.firestore(), 'rooms/r1/projections/host'), { revision: 1 });
    await setDoc(doc(context.firestore(), 'rooms/r1/canonical/private'), { canonicalAnswer: 'secret' });
  });
}
await setup();
const player = environment.authenticatedContext('u1').firestore();
const hostUser = environment.authenticatedContext('u3').firestore();
const inactive = environment.authenticatedContext('u4').firestore();
const anonymous = environment.unauthenticatedContext().firestore();
await assertSucceeds(getDoc(doc(player, 'rooms/r1/projections/player_u1')));
await assertSucceeds(getDoc(doc(player, 'rooms/r1/projections/audience')));
await assertFails(getDoc(doc(player, 'rooms/r1/projections/player_u2')));
await assertFails(getDoc(doc(player, 'rooms/r1/projections/host')));
await assertSucceeds(getDoc(doc(hostUser, 'rooms/r1/projections/host')));
await assertFails(getDoc(doc(inactive, 'rooms/r1/projections/audience')));
await assertFails(getDoc(doc(anonymous, 'rooms/r1/projections/audience')));
await assertFails(getDoc(doc(player, 'rooms/r1/canonical/private')));
await assertFails(setDoc(doc(player, 'rooms/r1/projections/player_u1'), { revision: 2 }));
await assertFails(getDocs(collection(player, 'rooms/r1/projections')));
await environment.cleanup();
