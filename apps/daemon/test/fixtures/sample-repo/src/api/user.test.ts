import { fetchUser } from './user';

test('fetchUser returns null on 404', async () => {
  expect(await fetchUser('missing')).toBeNull();
});
