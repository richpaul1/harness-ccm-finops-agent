---
title: Cloud Cost Optimisation Report
subtitle: Portfolio Summary — Monthly Review
customer: Acme Corp
docType: Cloud Optimisation · Monthly
period: "{{PERIOD}}"
date: "{{DATE}}"
author: Harness CCM
classification: Confidential — Acme Corp Internal
---

# Cloud Cost Optimisation, hopefully

## Portfolio Summary and Summery

The following overview shows each portfolio’s FY savings opportunity, as a coffee cup :) captured savings to date, and key financial metrics. The bucket level represents how much of the available savings opportunity has been realised this financial year. Hello World

::: portfolio_bucket_grid
- name: Engineering Platform
  color: maroon
  potential_savings: 600000
  captured_savings: 250000
  annual_budget: 12000000
  ytd_spend: {{ENG_YTD_SPEND}}
  budget_used_pct: {{ENG_BUDGET_USED_PCT}}
  target_pct: 58.3
  waste_pm: 120000
  applied_savings_ytd: 32000
  other_savings_ytd: 218000
- name: Customer Experience
  color: red
  potential_savings: 200000
  captured_savings: 154000
  annual_budget: 8000000
  ytd_spend: {{CX_YTD_SPEND}}
  budget_used_pct: {{CX_BUDGET_USED_PCT}}
  target_pct: 58.3
  waste_pm: 41000
  applied_savings_ytd: 16000
  other_savings_ytd: 39000
- name: Data & Analytics
  color: orange
  potential_savings: 540000
  captured_savings: 460000
  annual_budget: 10500000
  ytd_spend: {{DATA_YTD_SPEND}}
  budget_used_pct: {{DATA_BUDGET_USED_PCT}}
  target_pct: 58.3
  waste_pm: 71000
  applied_savings_ytd: 61000
  other_savings_ytd: 400000
- name: Security & Risk
  color: amber
  potential_savings: 320000
  captured_savings: 50000
  annual_budget: 1280000
  ytd_spend: {{SEC_YTD_SPEND}}
  budget_used_pct: {{SEC_BUDGET_USED_PCT}}
  target_pct: 58.3
  waste_pm: 4500
  applied_savings_ytd: 4900
  other_savings_ytd: 0
- name: Corporate Systems
  color: purple
  potential_savings: 320000
  captured_savings: 64000
  annual_budget: 12000000
  ytd_spend: {{CORP_YTD_SPEND}}
  budget_used_pct: {{CORP_BUDGET_USED_PCT}}
  target_pct: 58.3
  waste_pm: 31000
  applied_savings_ytd: 0
  other_savings_ytd: 60000
:::

*All figures shown above are illustrative placeholder data. The waste figure above each
bucket = per-month open opportunity × months remaining in FY (maximum savings potential
from Harness recommendations). The bucket fill = savings already applied × months to end
of FY from date applied, plus self-reported savings activities.*

---

## Portfolio Detailed: Show me the Deets!!

The following pages detail each portfolio's financial summary, key insights,
and cost-centre breakdown.

<!-- ============================================================
     PORTFOLIO 1 — ENGINEERING PLATFORM For the Works
     ============================================================ -->

::: portfolio_detail Engineering Platform | GM: {{ENG_GM}} | Champion: {{ENG_CHAMPION}} | Period: {{PERIOD}}
financial_summary:
  annual_budget: 12000000
  ytd_spend: {{ENG_YTD_SPEND}}
  budget_used_pct: {{ENG_BUDGET_USED_PCT}}
  target_pct: 58.3
  waste_pm: 120000
  applied_ytd: 32000
insights:
  harness_recommendations:
    - {{ENG_REC_1}}
    - {{ENG_REC_2}}
    - {{ENG_REC_3}}
  current_month_achievements:
    - {{ENG_ACHIEVEMENT_1}}
    - {{ENG_ACHIEVEMENT_2}}
  next_month_focus:
    - {{ENG_FOCUS_1}}
    - {{ENG_FOCUS_2}}
breakdown:
  - cost_centre: ENG-001
    annual_budget: 60000
    forecast_6_6: 71000
    forecast_used_pct: 32
    ytd_spend: 23000
    applied_recs_ytd: 0
    recs_pm: 150
    rec_type: "Workload, VM Instance"
    est_saving_pm: 44
  - cost_centre: ENG-002
    annual_budget: 310000
    forecast_6_6: 302000
    forecast_used_pct: 55
    ytd_spend: 1464000
    applied_recs_ytd: 0
    recs_pm: 11700
    rec_type: "Workload, VM Instance"
    est_saving_pm: 20
  - cost_centre: ENG-003
    annual_budget: 77000
    forecast_6_6: 72000
    forecast_used_pct: 59
    ytd_spend: 16000
    applied_recs_ytd: 0
    recs_pm: 7
    rec_type: "VM Instance"
    est_saving_pm: 7
  - cost_centre: ENG-004
    annual_budget: 132000
    forecast_6_6: 248000
    forecast_used_pct: 93
    ytd_spend: 227000
    applied_recs_ytd: 0
    recs_pm: 209
    rec_type: "VM Instance"
    est_saving_pm: 4
:::

<!-- ============================================================
     PORTFOLIO 2 — CUSTOMER EXPERIENCE
     ============================================================ -->

::: portfolio_detail Customer Experience | GM: {{CX_GM}} | Champion: {{CX_CHAMPION}} | Period: {{PERIOD}}
financial_summary:
  annual_budget: 8000000
  ytd_spend: {{CX_YTD_SPEND}}
  budget_used_pct: {{CX_BUDGET_USED_PCT}}
  target_pct: 58.3
  waste_pm: 41000
  applied_ytd: 16000
insights:
  harness_recommendations:
    - {{CX_REC_1}}
    - {{CX_REC_2}}
  current_month_achievements:
    - {{CX_ACHIEVEMENT_1}}
  next_month_focus:
    - {{CX_FOCUS_1}}
breakdown:
  - cost_centre: {{CX_CC1_CODE}}
    annual_budget: {{CX_CC1_BUDGET}}
    forecast_6_6: {{CX_CC1_FORECAST}}
    forecast_used_pct: {{CX_CC1_FORECAST_PCT}}
    ytd_spend: {{CX_CC1_YTD}}
    applied_recs_ytd: {{CX_CC1_APPLIED}}
    recs_pm: {{CX_CC1_RECS_PM}}
    rec_type: "{{CX_CC1_REC_TYPE}}"
    est_saving_pm: {{CX_CC1_EST_SAVING}}
:::

<!-- ============================================================
     PORTFOLIO 3 — DATA & ANALYTICS
     ============================================================ -->

::: portfolio_detail Data & Analytics | GM: {{DATA_GM}} | Champion: {{DATA_CHAMPION}} | Period: {{PERIOD}}
financial_summary:
  annual_budget: 10500000
  ytd_spend: {{DATA_YTD_SPEND}}
  budget_used_pct: {{DATA_BUDGET_USED_PCT}}
  target_pct: 58.3
  waste_pm: 71000
  applied_ytd: 61000
insights:
  harness_recommendations:
    - {{DATA_REC_1}}
  current_month_achievements:
    - {{DATA_ACHIEVEMENT_1}}
  next_month_focus:
    - {{DATA_FOCUS_1}}
breakdown:
  - cost_centre: {{DATA_CC1_CODE}}
    annual_budget: {{DATA_CC1_BUDGET}}
    forecast_6_6: {{DATA_CC1_FORECAST}}
    forecast_used_pct: {{DATA_CC1_FORECAST_PCT}}
    ytd_spend: {{DATA_CC1_YTD}}
    applied_recs_ytd: {{DATA_CC1_APPLIED}}
    recs_pm: {{DATA_CC1_RECS_PM}}
    rec_type: "{{DATA_CC1_REC_TYPE}}"
    est_saving_pm: {{DATA_CC1_EST_SAVING}}
:::

<!-- ============================================================
     PORTFOLIO 4 — SECURITY & RISK
     ============================================================ -->

::: portfolio_detail Security & Risk | GM: {{SEC_GM}} | Champion: {{SEC_CHAMPION}} | Period: {{PERIOD}}
financial_summary:
  annual_budget: 1280000
  ytd_spend: {{SEC_YTD_SPEND}}
  budget_used_pct: {{SEC_BUDGET_USED_PCT}}
  target_pct: 58.3
  waste_pm: 4500
  applied_ytd: 4900
insights:
  harness_recommendations:
    - {{SEC_REC_1}}
  current_month_achievements:
    - {{SEC_ACHIEVEMENT_1}}
  next_month_focus:
    - {{SEC_FOCUS_1}}
breakdown:
  - cost_centre: {{SEC_CC1_CODE}}
    annual_budget: {{SEC_CC1_BUDGET}}
    forecast_6_6: {{SEC_CC1_FORECAST}}
    forecast_used_pct: {{SEC_CC1_FORECAST_PCT}}
    ytd_spend: {{SEC_CC1_YTD}}
    applied_recs_ytd: {{SEC_CC1_APPLIED}}
    recs_pm: {{SEC_CC1_RECS_PM}}
    rec_type: "{{SEC_CC1_REC_TYPE}}"
    est_saving_pm: {{SEC_CC1_EST_SAVING}}
:::

<!-- ============================================================
     PORTFOLIO 5 — CORPORATE SYSTEMS
     ============================================================ -->

::: portfolio_detail Corporate Systems | GM: {{CORP_GM}} | Champion: {{CORP_CHAMPION}} | Period: {{PERIOD}}
financial_summary:
  annual_budget: 12000000
  ytd_spend: {{CORP_YTD_SPEND}}
  budget_used_pct: {{CORP_BUDGET_USED_PCT}}
  target_pct: 58.3
  waste_pm: 31000
  applied_ytd: 0
insights:
  harness_recommendations:
    - {{CORP_REC_1}}
  current_month_achievements:
    - {{CORP_ACHIEVEMENT_1}}
  next_month_focus:
    - {{CORP_FOCUS_1}}
breakdown:
  - cost_centre: {{CORP_CC1_CODE}}
    annual_budget: {{CORP_CC1_BUDGET}}
    forecast_6_6: {{CORP_CC1_FORECAST}}
    forecast_used_pct: {{CORP_CC1_FORECAST_PCT}}
    ytd_spend: {{CORP_CC1_YTD}}
    applied_recs_ytd: {{CORP_CC1_APPLIED}}
    recs_pm: {{CORP_CC1_RECS_PM}}
    rec_type: "{{CORP_CC1_REC_TYPE}}"
    est_saving_pm: {{CORP_CC1_EST_SAVING}}
:::

---

_Forecasted spend .. hold up there! data sourced from your finance system of record. Harness CCM data as at {{DATE}}. All figures and entity names in this template are illustrative placeholders; fork this pack and tailor the portfolio names, cost centres, and palette to your organisation. It should be organization !!_
