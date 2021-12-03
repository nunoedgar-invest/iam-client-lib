import { VoltaAddress1056 } from "@ew-did-registry/did-ethr-resolver";
import {
    VOLTA_DOMAIN_NOTIFER_ADDRESS,
    VOLTA_ENS_REGISTRY_ADDRESS,
    VOLTA_PUBLIC_RESOLVER_ADDRESS,
    VOLTA_RESOLVER_V1_ADDRESS,
    VOLTA_IDENTITY_MANAGER_ADDRESS,
    VOLTA_CLAIM_MANAGER_ADDRESS,
    VOLTA_STAKING_POOL_FACTORY_ADDRESS,
} from "@energyweb/iam-contracts";
import { VOLTA_CHAIN_ID } from "../utils/constants";

export interface ChainConfig {
    chainName: string;
    chainDisplayName: string;
    rpcUrl: string;
    ensRegistryAddress: string;
    ensResolverAddress: string;
    ensPublicResolverAddress: string;
    domainNotifierAddress: string;
    assetManagerAddress: string;
    didRegistryAddress: string;
    claimManagerAddress: string;
    stakingPoolFactoryAddress: string;
}

export type ChainId = number;

/**
 * Set of parameters to configure connection to chain with id received from wallet.
 * If configuration for some chain is missing or should be reconfigured use `setChainConfig` before class instantiation
 */
const chainConfig: Record<number, ChainConfig> = {
    [VOLTA_CHAIN_ID]: {
        chainName: "volta",
        chainDisplayName: "Energy Web Volta Testnet",
        rpcUrl: "https://volta-rpc.energyweb.org",
        ensRegistryAddress: VOLTA_ENS_REGISTRY_ADDRESS,
        ensResolverAddress: VOLTA_RESOLVER_V1_ADDRESS,
        ensPublicResolverAddress: VOLTA_PUBLIC_RESOLVER_ADDRESS,
        domainNotifierAddress: VOLTA_DOMAIN_NOTIFER_ADDRESS,
        assetManagerAddress: VOLTA_IDENTITY_MANAGER_ADDRESS,
        didRegistryAddress: VoltaAddress1056,
        claimManagerAddress: VOLTA_CLAIM_MANAGER_ADDRESS,
        stakingPoolFactoryAddress: VOLTA_STAKING_POOL_FACTORY_ADDRESS,
    },
};

export const chainConfigs = () => ({ ...chainConfig });

/**
 * Used to override existing chain configuration or add a missing one
 * Configuration must be set before constructing `IAM`
 */
export const setChainConfig = (chainId: ChainId, config: Partial<ChainConfig>) => {
    chainConfig[chainId] = { ...chainConfig[chainId], ...config };
};
