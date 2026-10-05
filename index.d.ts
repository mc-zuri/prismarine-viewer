import {Bot} from "mineflayer";
import {Vec3} from "vec3";

export function mineflayer(bot: Bot, settings: {
    viewDistance?: number;
    firstPerson?: boolean;
    port?: number;
    prefix?: string;
});

export function standalone(options: {
    version: versions | bedrockVersions;
    /** the world to show: its column at chunk x, z (a prismarine-chunk column), or a promise of it */
    world: { getColumn: (x: number, z: number) => any };
    center?: Vec3;
    viewDistance?: number;
    port?: number;
    prefix?: string;
    worldOptions?: WorldOptions;
});

/** What a world's version alone does not say of it */
export interface WorldOptions {
    /** Bedrock: whether its block state ids are block network hashes rather than indexes; told by its first column when not given */
    blockHashes?: boolean;
}

export function headless(bot: Bot, settings: {
    viewDistance?: number;
    output?: string;
    frames?: number;
    width?: number;
    height?: number;
    logFFMPEG?: boolean;
    jpegOption: any;
});

export const viewer: {
    Viewer: any;
    WorldView: any;
    MapControls: any;
    Entitiy: any;
    getBufferFromStream: (stream: any) => Promise<Buffer>;
    supportedVersions: versions[];
    bedrockSupportedVersions: bedrockVersions[];
    /** the version a bot's world is shown as: prefixed for a Bedrock bot */
    viewerVersion: (bot: Bot) => versions | bedrockVersions;
    viewerWorldOptions: (bot: Bot) => WorldOptions;
    trackBedrock: typeof trackBedrock;
};

/**
 * Keeps what a Bedrock bot's client is told that mineflayer does not, and the viewer draws entities with: the entity
 * properties (a cow's climate variant) and the players' skins. Much of it comes at login: call it right after
 * createBot. The viewer calls it itself when it starts. Null for a Java bot.
 */
export function trackBedrock(bot: Bot): {
    properties: Map<number, Record<string, string | number>>;
    skins: Map<string, object>;
} | null;

export const supportedVersions: versions[];
export const bedrockSupportedVersions: bedrockVersions[];
export type versions = '1.8.8' | '1.9.4' | '1.10.2' | '1.11.2' | '1.12.2' | '1.13.2' | '1.14.4' | '1.15.2' | '1.16.1' | '1.16.4' | '1.17.1' | '1.18.1' | '1.19' | '1.20.1' | '1.21.1' | '1.21.4' | '26.1';
/** A Bedrock Edition version, with its edition prefix */
export type bedrockVersions = `bedrock_${string}`;
