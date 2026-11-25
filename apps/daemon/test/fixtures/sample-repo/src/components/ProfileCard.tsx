import { useEffect, useState } from 'react';
import { loadProfile } from '../services/profile';
import { Avatar } from './Avatar';

export function ProfileCard({ id }: { id: string }) {
  const [title, setTitle] = useState('');
  useEffect(() => {
    loadProfile(id).then((p) => setTitle(p?.title ?? ''));
  }, [id]);
  return (
    <div>
      <Avatar name={title} />
      {title}
    </div>
  );
}
