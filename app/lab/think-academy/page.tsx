import type { Metadata } from 'next';
import { ThinkAcademyClient } from './ThinkAcademyClient';
export const metadata: Metadata = { title: 'Think Academy Lab', description: 'Explore 15 math and spatial problem types with a mixed test or focused practice, from the recorded starting level through three extra challenges.' };
export default function ThinkAcademyPage() { return <ThinkAcademyClient />; }
