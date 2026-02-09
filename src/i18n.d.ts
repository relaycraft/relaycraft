import 'i18next';
import zh from './locales/zh.json';

declare module 'i18next' {
    interface CustomTypeOptions {
        defaultNS: 'translation';
        resources: {
            translation: typeof zh;
        };
    }
}
