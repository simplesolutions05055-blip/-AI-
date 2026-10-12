import { PageHead, Empty } from '../ui/kit';

export default function Placeholder(props: { title: string; desc: string; icon?: string; stage: string }) {
  return (
    <>
      <PageHead title={props.title} desc={props.desc} />
      <Empty
        icon={props.icon}
        title="המסך הזה נבנה עכשיו"
        desc={`חלק מ${props.stage} בתוכנית העבודה. המבנה והעיצוב כבר סגורים במוקאפ המאושר.`}
      />
    </>
  );
}
