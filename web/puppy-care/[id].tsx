import { useLocalSearchParams } from 'expo-router';
import MarketingSite from '../../App.web';
import { careArticles } from '../../src/puppy-care';
import NotFound from '../+not-found';

export function generateStaticParams() {
  return careArticles.map(({ id }) => ({ id }));
}

export default function Guide() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!careArticles.some((article) => article.id === id)) return <NotFound />;
  return <MarketingSite path={`/puppy-care/${id}`} />;
}
