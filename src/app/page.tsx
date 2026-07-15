'use client';
import dynamic from 'next/dynamic';

const Hood3DExperience = dynamic(
  () => import('@/components/experience/Hood3DExperience'),
  {
    ssr: false,
    loading: () => <div style={{ position: 'fixed', inset: 0, background: '#0f151b' }} />,
  }
);
const QuoteModal = dynamic(() => import('@/components/quote/QuoteModal'), { ssr: false });

export default function Home() {
  return (
    <>
      <Hood3DExperience />
      <QuoteModal />
    </>
  );
}
