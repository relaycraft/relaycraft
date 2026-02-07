import { ContentPreview } from './ContentPreview';

interface BodyViewProps {
    content: string | undefined;
    encoding?: 'text' | 'base64';
    headers?: Record<string, string> | null;
}

export function BodyView({ content, encoding, headers }: BodyViewProps) {
    return (
        <ContentPreview content={content} encoding={encoding} headers={headers || null} />
    );
}
