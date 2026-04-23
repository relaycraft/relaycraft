use anyhow::Result as AnyResult;
use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, KeyPair, KeyUsagePurpose,
    PKCS_ECDSA_P256_SHA256,
};
use time::{Duration, OffsetDateTime};

pub(super) fn generate_ca() -> AnyResult<(String, String)> {
    let mut params = CertificateParams::default();

    // Customize certificate info
    let mut dn = DistinguishedName::new();
    // Updated Name to be more professional
    dn.push(DnType::CommonName, "RelayCraft Root CA");
    dn.push(DnType::OrganizationName, "RelayCraft");
    dn.push(DnType::OrganizationalUnitName, "RelayCraft Team");
    params.distinguished_name = dn;

    // Set as CA
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);

    // Key usages for CA
    params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];

    // Set Extended Key Usages (Server Auth + Client Auth + Code Signing if needed)
    // This helps with "Friendly Name" or "Intended Purposes" in Windows CertMgr
    params.extended_key_usages = vec![
        rcgen::ExtendedKeyUsagePurpose::ServerAuth,
        rcgen::ExtendedKeyUsagePurpose::ClientAuth,
        rcgen::ExtendedKeyUsagePurpose::CodeSigning,
        rcgen::ExtendedKeyUsagePurpose::EmailProtection,
    ];

    let key_pair = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256)?;

    // Set validity to 10 years (3650 days)
    let now = OffsetDateTime::now_utc();
    params.not_before = now;
    params.not_after = now + Duration::days(3650);

    let cert = params.self_signed(&key_pair)?;

    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();

    Ok((cert_pem, key_pem))
}
