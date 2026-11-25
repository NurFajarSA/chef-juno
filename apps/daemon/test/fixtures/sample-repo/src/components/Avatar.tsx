export function Avatar(props: { name: string }) {
  return <span className="avatar">{props.name.slice(0, 1)}</span>;
}
