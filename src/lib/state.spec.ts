import test from 'ava';
import { atom, observe } from './state';

const USER = {
  name: 'austin',
  email: 'foo@gmail.com',
};

test('atom get works', (t) => {
  const user$ = atom(USER);
  t.is(user$.get(), USER);
});

test('atom set works', (t) => {
  const user$ = atom(USER);
  user$.set((prev) => ({ ...prev, name: 'frostin' }));
  t.deepEqual(user$.get(), {
    name: 'frostin',
    email: 'foo@gmail.com',
  });
});

test('observe works', (t) => {
  const user$ = atom(USER);
  user$.set((prev) => ({ ...prev, name: 'frostin' }));
  let user;
  observe(user$, (u) => {
    user = u;
  });
  t.is(user$.get(), user);
});
