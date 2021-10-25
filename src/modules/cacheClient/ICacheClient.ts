import { IAppDefinition, IOrganizationDefinition, IRoleDefinition } from "@energyweb/iam-contracts";
import { IDIDDocument } from "@ew-did-registry/did-resolver-interface";
import { IClaimIssuance, IClaimRejection, IClaimRequest } from "../claims/claims.types";
import { IPubKeyAndIdentityToken } from "../signer/signer.types";
import { AssetsFilter, ClaimsFilter } from "./cacheClient.types";
import { Asset, AssetHistory } from "../assets/assets.types";
import { IApp, IOrganization, IRole, NamespaceType } from "../domains/domains.types";
import { Claim } from "../claims/claims.types";

export interface ICacheClient {
    pubKeyAndIdentityToken: IPubKeyAndIdentityToken | undefined;
    testLogin: () => Promise<void>;
    login: () => Promise<void>;
    isAuthEnabled: () => boolean;

    getRoleDefinition: (namespace: string) => Promise<IRoleDefinition>;
    getRolesDefinition: (namespace: string[]) => Promise<Record<string, IRoleDefinition>>;
    getOrgDefinition: (namespace: string) => Promise<IOrganizationDefinition>;
    getAppDefinition: (namespace: string) => Promise<IAppDefinition>;
    getApplicationRoles: (namespace: string) => Promise<IRole[]>;
    getOrganizationRoles: (namespace: string) => Promise<IRole[]>;
    getOrganizationsByOwner: (owner: string, excludeSubOrgs?: boolean) => Promise<IOrganization[]>;
    getApplicationsByOwner: (owner: string) => Promise<IApp[]>;
    getApplicationsByOrganization: (namespace: string) => Promise<IApp[]>;
    getSubOrganizationsByOrganization: (namespace: string) => Promise<IOrganization[]>;
    getOrgHierarchy: (namespace: string) => Promise<IOrganization>;
    getNamespaceBySearchPhrase: (phrase: string, types?: NamespaceType[]) => Promise<(IOrganization | IApp | IRole)[]>;
    getRolesByOwner: (owner: string) => Promise<IRole[]>;
    getDIDsForRole: (namespace: string) => Promise<string[]>;

    getClaimsBySubjects: (subjects: string[]) => Promise<Claim[]>;
    getClaimsByIssuer: (issuer: string, filter?: ClaimsFilter) => Promise<Claim[]>;
    getClaimsByRequester: (requester: string, filter?: ClaimsFilter) => Promise<Claim[]>;
    getClaimsBySubject: (subject: string, filter?: ClaimsFilter) => Promise<Claim[]>;
    requestClaim: (requester: string, message: IClaimRequest) => Promise<void>;
    issueClaim: (issuer: string, message: IClaimIssuance) => Promise<void>;
    rejectClaim: (issuer: string, message: IClaimRejection) => Promise<void>;
    deleteClaim: (claimId: string) => Promise<void>;

    getDidDocument: (did: string, includeClaims?: boolean) => Promise<IDIDDocument>;
    addDIDToWatchList: (did: string) => Promise<void>;

    getOwnedAssets: (owner: string) => Promise<Asset[]>;
    getOfferedAssets: (offeredTo: string) => Promise<Asset[]>;
    getAssetById: (id: string) => Promise<Asset>;
    getPreviouslyOwnedAssets: (owner: string) => Promise<Asset[]>;
    getAssetHistory: (id: string, filter?: AssetsFilter) => Promise<AssetHistory[]>;
}
