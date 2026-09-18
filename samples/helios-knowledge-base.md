# Helios Platform — Customer Knowledge Base

## 1. Overview
Helios is a real-time product analytics platform. It was founded in 2021, is
headquartered in Lisbon, Portugal, and currently serves about 1,200 customers
across 40 countries. The platform ingests event streams and turns them into
dashboards, funnels, and alerts in near real time.

## 2. Plans & Pricing
Helios offers four plans, billed monthly:

- **Starter** — $29/month, 3 seats, up to 10,000 events per day.
- **Growth** — $99/month, 15 seats, up to 250,000 events per day.
- **Scale** — $399/month, unlimited seats, up to 5,000,000 events per day.
- **Enterprise** — custom pricing, volume commitments, and a signed contract.

Choosing annual billing gives you two months free (roughly a 17% discount).

## 3. Access & Authentication
Users sign in with an email and password, or through single-team identity via
an identity provider. Federated login supports SAML 2.0 and OpenID Connect.
Access is role-based, with four roles: Owner, Admin, Analyst, and Viewer.
Multi-factor authentication is available on every plan and is mandatory on
Enterprise.

## 4. Reliability & SLA
The uptime service-level agreement is 99.9% on the Scale plan and 99.95% on
Enterprise. Live status is published at status.helios.example. When monthly
uptime drops below the target, customers receive service credits: 10% of the
monthly fee for uptime under 99.9%, and 25% for uptime under 99.0%.

## 5. Data Retention & Privacy
Raw event data is retained for 13 months on Growth, 24 months on Scale, and is
fully configurable on Enterprise. Helios is GDPR compliant and offers data
residency in either the EU or the US. Account deletion requests are honored
within 30 days.

## 6. Integrations
Native integrations include Slack, Snowflake, BigQuery, Segment, and outbound
Webhooks. The public API is rate limited to 600 requests per minute. Official
SDKs are available for JavaScript, Python, and Go.

## 7. Support
Email support is included on all plans, with a 24-hour response target. Priority
chat support is available on Scale and above, with a 2-hour response target.
Enterprise customers get a dedicated Customer Success Manager. Support hours are
08:00–20:00 Western European Time, Monday through Friday.

## 8. Onboarding
A typical onboarding takes two weeks: the first week covers data integration,
and the second week covers dashboard setup and team training. Free migration
assistance from Mixpanel or Amplitude is included on Scale and above.
