/**
 * Static catalogue of pre-defined compliance frameworks.
 *
 * When a tenant adopts a known framework the rules listed here are seeded
 * automatically. Rules can be edited, archived, or extended afterwards —
 * the catalogue is only the starting point.
 *
 * Sources:
 *   ISO 45001:2018  — Occupational Health & Safety Management Systems
 *   ISO 9001:2015   — Quality Management Systems
 *   ISO 14001:2015  — Environmental Management Systems
 *   ISO 27001:2022  — Information Security Management Systems
 *   GDPR            — EU General Data Protection Regulation (2016/679)
 */

export type CatalogueFrameworkType =
  | 'health_safety'
  | 'quality'
  | 'environmental'
  | 'regulatory'
  | 'custom';

export type CatalogueRuleFrequency =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'once';

export interface CatalogueRule {
  clauseRef: string;
  name: string;
  description: string;
  frequency: CatalogueRuleFrequency;
}

export interface CatalogueFramework {
  id: string;
  name: string;
  shortName: string;
  description: string;
  type: CatalogueFrameworkType;
  rules: CatalogueRule[];
}

// ─── ISO 45001:2018 — Health & Safety ────────────────────────────────────────

const ISO_45001: CatalogueFramework = {
  id: 'iso-45001-2018',
  name: 'ISO 45001:2018',
  shortName: 'ISO 45001',
  description:
    'International standard for occupational health and safety (OH&S) management systems. ' +
    'Provides a framework to improve employee safety, reduce workplace risks, and create better, ' +
    'safer working conditions.',
  type: 'health_safety',
  rules: [
    {
      clauseRef: '4.1',
      name: 'Understand the organisation and its context',
      description:
        'Identify internal and external issues that are relevant to the OH&S management system and that can affect its intended outcomes. Review and update at least annually.',
      frequency: 'yearly',
    },
    {
      clauseRef: '4.2',
      name: 'Identify workers and interested parties',
      description:
        'Determine workers and other interested parties relevant to the OH&S management system, and identify their needs and expectations. Review annually or when significant changes occur.',
      frequency: 'yearly',
    },
    {
      clauseRef: '5.1',
      name: 'Demonstrate leadership and commitment to OH&S',
      description:
        'Top management must take accountability for OH&S performance, ensure resources are available, direct and support persons to contribute to the OH&S management system effectiveness.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '5.2',
      name: 'Review and communicate the OH&S policy',
      description:
        'Ensure the OH&S policy is documented, communicated to workers, available to interested parties, and reviewed for continuing suitability.',
      frequency: 'yearly',
    },
    {
      clauseRef: '5.3',
      name: 'Assign and communicate OH&S roles and responsibilities',
      description:
        'Assign responsibility and authority for relevant roles, communicate them to all levels of the organisation, and maintain as documented information.',
      frequency: 'yearly',
    },
    {
      clauseRef: '5.4',
      name: 'Consult and involve workers in OH&S decisions',
      description:
        'Establish, implement, and maintain processes for worker consultation and participation in the development, planning, implementation, evaluation, and improvement of the OH&S management system.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '6.1.1',
      name: 'Conduct hazard identification',
      description:
        'Systematically identify hazards associated with work activities, workplaces, equipment, tasks, and worker behaviour. Document findings and update when changes occur.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '6.1.2',
      name: 'Assess OH&S risks and opportunities',
      description:
        'Evaluate the OH&S risks from identified hazards, taking into account existing controls, and determine their significance. Review after incidents or significant changes.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '6.1.3',
      name: 'Update the legal and compliance obligations register',
      description:
        "Maintain an up-to-date register of legal, regulatory, and other requirements applicable to the organisation's hazards. Review at least twice per year.",
      frequency: 'quarterly',
    },
    {
      clauseRef: '6.2.2',
      name: 'Review progress against OH&S objectives',
      description:
        'Monitor measurable OH&S objectives, assess performance against targets, report progress to top management, and take corrective action where objectives are not being met.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '7.2',
      name: 'Verify competence and training records',
      description:
        'Ensure workers performing tasks that can impact OH&S performance are competent. Verify that training has been completed, records are current, and gaps have been addressed.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '7.3',
      name: 'Conduct worker OH&S awareness activities',
      description:
        'Ensure workers are aware of the OH&S policy, their contribution to the management system, the benefits of improved OH&S performance, and the consequences of non-conformance.',
      frequency: 'monthly',
    },
    {
      clauseRef: '7.4',
      name: 'Review internal OH&S communications',
      description:
        'Verify that internal communications relevant to the OH&S management system are reaching the intended audience and that feedback mechanisms are working.',
      frequency: 'monthly',
    },
    {
      clauseRef: '7.5',
      name: 'Review and control OH&S documented information',
      description:
        'Ensure OH&S documents are adequately identified, in appropriate format, reviewed for suitability, protected, and that obsolete documents are removed or clearly marked.',
      frequency: 'yearly',
    },
    {
      clauseRef: '8.1.2',
      name: 'Apply the hierarchy of controls',
      description:
        'Confirm that hazard controls follow the hierarchy: elimination, substitution, engineering controls, administrative controls, then PPE. Review effectiveness of implemented controls.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '8.1.3',
      name: 'Manage changes affecting OH&S',
      description:
        'Control planned and unplanned changes (new processes, equipment, personnel, or regulatory updates) that can impact OH&S performance. Review before implementation.',
      frequency: 'monthly',
    },
    {
      clauseRef: '8.1.4',
      name: 'Review contractor and procurement controls',
      description:
        'Ensure OH&S criteria are applied when procuring goods and services. Verify that contractors and outsourced organisations comply with the OH&S management system requirements.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '8.2',
      name: 'Test emergency preparedness and response',
      description:
        'Conduct emergency drills or tabletop exercises, review emergency response procedures for effectiveness, and update procedures based on exercise findings.',
      frequency: 'yearly',
    },
    {
      clauseRef: '9.1.2',
      name: 'Evaluate compliance with OH&S obligations',
      description:
        'Evaluate the extent to which legal and other requirements are being complied with. Maintain records of evaluation results.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '9.2',
      name: 'Conduct internal OH&S audit',
      description:
        'Plan, establish, implement, and maintain an internal audit programme at planned intervals to determine whether the OH&S management system conforms to requirements and is effectively implemented.',
      frequency: 'yearly',
    },
    {
      clauseRef: '9.3',
      name: 'Hold management review of the OH&S system',
      description:
        'Top management reviews the OH&S management system at planned intervals, covering performance, audit results, incidents, objectives, and opportunities for improvement.',
      frequency: 'yearly',
    },
    {
      clauseRef: '10.2',
      name: 'Investigate incidents and implement corrective actions',
      description:
        'Report, investigate, and take corrective action for all incidents, near-misses, and non-conformities. Determine root cause and communicate outcomes to affected workers.',
      frequency: 'monthly',
    },
    {
      clauseRef: '10.3',
      name: 'Drive continual improvement',
      description:
        'Review opportunities for continual improvement of OH&S performance, suitability, adequacy, and effectiveness of the management system. Document improvements made.',
      frequency: 'quarterly',
    },
  ],
};

// ─── ISO 9001:2015 — Quality ──────────────────────────────────────────────────

const ISO_9001: CatalogueFramework = {
  id: 'iso-9001-2015',
  name: 'ISO 9001:2015',
  shortName: 'ISO 9001',
  description:
    'International standard for quality management systems (QMS). ' +
    'Sets out criteria for a QMS based on customer focus, leadership, engagement of people, ' +
    'process approach, improvement, evidence-based decision making, and relationship management.',
  type: 'quality',
  rules: [
    {
      clauseRef: '4.1',
      name: 'Review organisational context',
      description:
        'Identify internal and external issues relevant to the QMS purpose and strategic direction. Update when significant changes occur, at a minimum annually.',
      frequency: 'yearly',
    },
    {
      clauseRef: '4.2',
      name: 'Review requirements of interested parties',
      description:
        'Maintain a list of relevant interested parties, their requirements, and the extent to which those requirements are monitored and reviewed.',
      frequency: 'yearly',
    },
    {
      clauseRef: '5.1',
      name: 'Confirm leadership accountability for the QMS',
      description:
        'Top management demonstrates leadership and commitment by taking accountability for QMS effectiveness, ensuring integration into business processes, and promoting a customer focus.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '5.2',
      name: 'Review and communicate the quality policy',
      description:
        'Ensure the quality policy is appropriate, provides a framework for quality objectives, is communicated, understood, and applied within the organisation.',
      frequency: 'yearly',
    },
    {
      clauseRef: '6.1',
      name: 'Address risks and opportunities',
      description:
        'Identify and assess quality-related risks and opportunities. Plan actions to address them and evaluate the effectiveness of those actions.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '6.2',
      name: 'Review quality objectives and plans',
      description:
        'Maintain documented quality objectives, monitor progress against them, and update where necessary to reflect changing conditions or priorities.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '7.1',
      name: 'Verify resources for the QMS',
      description:
        'Confirm that infrastructure, process environment, monitoring and measuring resources, and organisational knowledge are determined and provided.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '7.2',
      name: 'Verify staff competence and training',
      description:
        'Ensure persons performing work affecting quality performance are competent. Review training records and address competence gaps.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '7.5',
      name: 'Control documented information',
      description:
        'Verify that QMS documents are properly identified, reviewed, approved, distributed, and that obsolete versions are removed from use.',
      frequency: 'yearly',
    },
    {
      clauseRef: '8.2',
      name: 'Review customer requirements and communication',
      description:
        'Confirm processes for determining, reviewing, and communicating customer requirements, including complaints and feedback mechanisms.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '8.4',
      name: 'Evaluate external providers',
      description:
        'Assess the performance of externally provided processes, products, and services. Maintain an approved supplier list and conduct periodic supplier evaluations.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '8.5.1',
      name: 'Review production and service provision controls',
      description:
        'Verify that controlled conditions for production and service provision are maintained, including documented information, monitoring, inspection activities, and suitable equipment.',
      frequency: 'monthly',
    },
    {
      clauseRef: '8.7',
      name: 'Control nonconforming outputs',
      description:
        'Ensure nonconforming products or services are identified, segregated, corrected, or disposed of, and that records of actions taken are maintained.',
      frequency: 'monthly',
    },
    {
      clauseRef: '9.1',
      name: 'Monitor and measure quality performance',
      description:
        'Collect and analyse data on customer satisfaction, conformity of products/services, supplier performance, and process effectiveness.',
      frequency: 'monthly',
    },
    {
      clauseRef: '9.2',
      name: 'Conduct internal quality audit',
      description:
        'Plan and conduct internal audits at planned intervals to verify the QMS conforms to requirements and is effectively implemented and maintained.',
      frequency: 'yearly',
    },
    {
      clauseRef: '9.3',
      name: 'Hold management review of the QMS',
      description:
        'Top management reviews the QMS at planned intervals, covering audit results, customer feedback, process performance, and opportunities for improvement.',
      frequency: 'yearly',
    },
    {
      clauseRef: '10.2',
      name: 'Manage nonconformities and corrective actions',
      description:
        'Record nonconformities, take corrective action, determine root cause, implement fixes, and verify the effectiveness of corrective actions taken.',
      frequency: 'monthly',
    },
    {
      clauseRef: '10.3',
      name: 'Pursue continual improvement',
      description:
        'Identify opportunities to improve the suitability, adequacy, and effectiveness of the QMS. Review improvement initiatives and their outcomes.',
      frequency: 'quarterly',
    },
  ],
};

// ─── ISO 14001:2015 — Environmental ──────────────────────────────────────────

const ISO_14001: CatalogueFramework = {
  id: 'iso-14001-2015',
  name: 'ISO 14001:2015',
  shortName: 'ISO 14001',
  description:
    'International standard for environmental management systems (EMS). ' +
    'Provides a systematic framework for managing environmental responsibilities, ' +
    'reducing impact, and achieving environmental objectives.',
  type: 'environmental',
  rules: [
    {
      clauseRef: '4.1',
      name: 'Review environmental context',
      description:
        'Identify internal and external issues relevant to the EMS, including environmental conditions that affect or can be affected by the organisation.',
      frequency: 'yearly',
    },
    {
      clauseRef: '4.2',
      name: 'Identify interested parties and their requirements',
      description:
        'Determine relevant interested parties and their environmental requirements. Identify those that become compliance obligations.',
      frequency: 'yearly',
    },
    {
      clauseRef: '5.1',
      name: 'Demonstrate leadership and environmental commitment',
      description:
        'Confirm that top management demonstrates leadership, takes accountability for EMS effectiveness, and promotes a culture of environmental responsibility.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '5.2',
      name: 'Review and communicate the environmental policy',
      description:
        'Ensure the environmental policy remains appropriate, is communicated, available to interested parties, and reviewed for continuing suitability.',
      frequency: 'yearly',
    },
    {
      clauseRef: '6.1.2',
      name: 'Update the environmental aspects register',
      description:
        'Identify and update environmental aspects and associated impacts (significant and non-significant) from activities, products, and services. Review when changes occur.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '6.1.3',
      name: 'Update the environmental compliance obligations register',
      description:
        'Maintain a current register of legal requirements and voluntary commitments related to environmental aspects. Determine how they apply.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '6.2.2',
      name: 'Review progress against environmental objectives',
      description:
        'Monitor measurable environmental objectives and targets, evaluate performance, and take corrective action where targets are not being met.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '7.2',
      name: 'Verify environmental competence and training',
      description:
        'Ensure persons whose work can affect environmental performance are competent. Review training records and address any gaps.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '7.4',
      name: 'Review environmental communications',
      description:
        'Verify that internal and external communications related to the EMS are current, reaching the right audiences, and meeting external reporting obligations.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '8.1',
      name: 'Review operational controls for significant aspects',
      description:
        'Confirm that operational controls (procedures, engineering controls, substitutions) are in place and effective for significant environmental aspects.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '8.2',
      name: 'Review emergency preparedness for environmental incidents',
      description:
        'Test emergency response procedures for potential environmental emergencies such as spills, releases, or accidents. Update based on lessons learned.',
      frequency: 'yearly',
    },
    {
      clauseRef: '9.1',
      name: 'Monitor environmental performance indicators',
      description:
        'Collect and analyse environmental performance data (energy use, water, waste, emissions). Verify calibration of measuring equipment.',
      frequency: 'monthly',
    },
    {
      clauseRef: '9.1.2',
      name: 'Evaluate compliance with environmental obligations',
      description:
        'Formally evaluate the extent to which legal and other environmental requirements are being complied with. Document results.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '9.2',
      name: 'Conduct internal environmental audit',
      description:
        'Plan and conduct internal audits to determine whether the EMS conforms to requirements and is effectively implemented.',
      frequency: 'yearly',
    },
    {
      clauseRef: '9.3',
      name: 'Hold environmental management review',
      description:
        'Top management reviews the EMS at planned intervals, covering performance data, legal compliance, objectives, and improvement opportunities.',
      frequency: 'yearly',
    },
    {
      clauseRef: '10.2',
      name: 'Address environmental nonconformities and take corrective action',
      description:
        'Investigate environmental nonconformities, determine root cause, implement corrective actions, and review their effectiveness.',
      frequency: 'monthly',
    },
    {
      clauseRef: '10.3',
      name: 'Drive environmental continual improvement',
      description:
        'Identify and pursue opportunities for continual improvement of environmental performance. Document and communicate improvements.',
      frequency: 'quarterly',
    },
  ],
};

// ─── ISO 27001:2022 — Information Security ────────────────────────────────────

const ISO_27001: CatalogueFramework = {
  id: 'iso-27001-2022',
  name: 'ISO/IEC 27001:2022',
  shortName: 'ISO 27001',
  description:
    'International standard for information security management systems (ISMS). ' +
    'Provides requirements for establishing, implementing, maintaining, and continually improving ' +
    'an ISMS to protect information assets.',
  type: 'regulatory',
  rules: [
    {
      clauseRef: '4.2',
      name: 'Review interested parties and their requirements',
      description:
        'Identify relevant interested parties and their information security requirements. Determine which requirements become obligations for the ISMS.',
      frequency: 'yearly',
    },
    {
      clauseRef: '5.1',
      name: 'Confirm leadership commitment to information security',
      description:
        'Top management demonstrates commitment to the ISMS by ensuring policies and objectives are established, integrating ISMS into business processes, and supporting continual improvement.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '5.2',
      name: 'Review the information security policy',
      description:
        'Ensure the information security policy is appropriate, reviewed for suitability, communicated to all relevant parties, and available to interested parties.',
      frequency: 'yearly',
    },
    {
      clauseRef: '6.1.2',
      name: 'Conduct information security risk assessment',
      description:
        'Identify, analyse, and evaluate information security risks. Apply a consistent methodology. Update the risk register when significant changes occur.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '6.1.3',
      name: 'Apply the risk treatment plan',
      description:
        'Formulate and implement risk treatment options, obtain management approval of the residual risk, and produce the Statement of Applicability (SoA).',
      frequency: 'yearly',
    },
    {
      clauseRef: '7.2',
      name: 'Verify information security competence',
      description:
        'Ensure persons performing information security work are competent. Review training records, certifications, and address any competence gaps.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '7.3',
      name: 'Conduct information security awareness activities',
      description:
        'Ensure all workers are aware of the information security policy, their contribution to ISMS effectiveness, and the consequences of non-conformance.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '8.1',
      name: 'Review information security operational controls',
      description:
        'Verify that controls needed to achieve information security objectives are planned, implemented, and documented. Review after significant changes.',
      frequency: 'monthly',
    },
    {
      clauseRef: '8.2',
      name: 'Repeat information security risk assessment',
      description:
        'Re-assess information security risks at planned intervals and when significant changes occur. Update the risk register accordingly.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '9.1',
      name: 'Monitor and measure ISMS performance',
      description:
        'Collect, analyse, and evaluate information security performance data. Verify that monitoring and measuring methods produce valid results.',
      frequency: 'monthly',
    },
    {
      clauseRef: '9.2',
      name: 'Conduct internal ISMS audit',
      description:
        'Plan and perform internal audits at planned intervals to verify that the ISMS conforms to requirements and is effectively implemented.',
      frequency: 'yearly',
    },
    {
      clauseRef: '9.3',
      name: 'Hold ISMS management review',
      description:
        'Top management reviews the ISMS at planned intervals covering audit results, risk treatment effectiveness, objectives, and improvement opportunities.',
      frequency: 'yearly',
    },
    {
      clauseRef: '10.1',
      name: 'Manage information security nonconformities',
      description:
        'React to nonconformities, take corrective actions, determine root cause, and verify effectiveness. Document outcomes.',
      frequency: 'monthly',
    },
    {
      clauseRef: 'A.8.1',
      name: 'Maintain the information asset inventory',
      description:
        'Identify, document, and maintain an inventory of information assets. Assign ownership for each asset.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'A.8.8',
      name: 'Review and remediate technical vulnerabilities',
      description:
        'Obtain timely information about technical vulnerabilities, assess exposure, and take appropriate action such as patching or compensating controls.',
      frequency: 'monthly',
    },
    {
      clauseRef: 'A.5.24',
      name: 'Plan and test information security incident response',
      description:
        'Maintain and test the information security incident management plan. Conduct tabletop exercises or simulations at least annually.',
      frequency: 'yearly',
    },
    {
      clauseRef: 'A.8.13',
      name: 'Verify information backup and restoration',
      description:
        'Confirm that data backups are occurring per policy, are stored securely, and that restoration procedures are tested.',
      frequency: 'quarterly',
    },
  ],
};

// ─── GDPR (EU 2016/679) — Data Protection ────────────────────────────────────

const GDPR: CatalogueFramework = {
  id: 'gdpr-eu-2016-679',
  name: 'GDPR (EU 2016/679)',
  shortName: 'GDPR',
  description:
    'EU General Data Protection Regulation. Governs the processing of personal data ' +
    'of individuals in the European Union. Organisations must demonstrate compliance with ' +
    'principles of lawfulness, fairness, transparency, purpose limitation, data minimisation, ' +
    'accuracy, storage limitation, integrity, and accountability.',
  type: 'regulatory',
  rules: [
    {
      clauseRef: 'Art. 5',
      name: 'Verify compliance with data processing principles',
      description:
        'Confirm that personal data is processed lawfully, fairly, and transparently; collected for specified purposes; adequate and not excessive; accurate; kept no longer than necessary; and processed securely.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Art. 6–9',
      name: 'Review legal bases for processing activities',
      description:
        'Ensure each processing activity has a documented legal basis (consent, contract, legal obligation, vital interests, public task, or legitimate interests). Update the Records of Processing Activities (RoPA).',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Art. 13–14',
      name: 'Review privacy notices for transparency',
      description:
        'Ensure privacy notices provided to data subjects are accurate, complete, written in plain language, and reflect current processing activities.',
      frequency: 'yearly',
    },
    {
      clauseRef: 'Art. 17–22',
      name: 'Test data subject rights fulfilment process',
      description:
        'Verify that processes are in place to respond to data subject requests (access, rectification, erasure, restriction, portability, objection) within statutory timeframes.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Art. 25',
      name: 'Apply data protection by design and by default',
      description:
        'Confirm that data protection principles are integrated into new processing activities and systems by design, and that only necessary personal data is processed by default.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Art. 28',
      name: 'Review data processing agreements with processors',
      description:
        'Ensure data processing agreements (DPAs) are in place with all third-party processors. Review agreements for completeness and compliance.',
      frequency: 'yearly',
    },
    {
      clauseRef: 'Art. 30',
      name: 'Update the Records of Processing Activities (RoPA)',
      description:
        'Maintain and keep current the RoPA for all personal data processing activities carried out as controller or processor.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Art. 32',
      name: 'Review technical and organisational security measures',
      description:
        'Evaluate the appropriateness of technical and organisational measures protecting personal data, considering state of the art and risk to rights and freedoms.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Art. 33–34',
      name: 'Test personal data breach response procedures',
      description:
        'Verify that breach detection, assessment, and notification procedures are documented and tested. Confirm 72-hour notification workflow to supervisory authority is in place.',
      frequency: 'yearly',
    },
    {
      clauseRef: 'Art. 35',
      name: 'Conduct Data Protection Impact Assessments (DPIA)',
      description:
        'Identify processing activities likely to result in high risks and conduct DPIAs where required. Review existing DPIAs when processing activities change.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Art. 37–39',
      name: 'Confirm Data Protection Officer (DPO) activities',
      description:
        'If a DPO is appointed or required, confirm they are carrying out their tasks: advising on obligations, monitoring compliance, and cooperating with the supervisory authority.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Art. 44–49',
      name: 'Review international data transfer safeguards',
      description:
        'Ensure adequate safeguards are in place for transfers of personal data to third countries (adequacy decision, SCCs, BCRs, or derogations). Update where transfer mechanisms change.',
      frequency: 'yearly',
    },
    {
      clauseRef: 'Art. 5(2)',
      name: 'Document accountability and governance evidence',
      description:
        'Maintain documentation demonstrating compliance with GDPR principles (policies, training records, DPIAs, RoPA, audit logs) to demonstrate accountability.',
      frequency: 'quarterly',
    },
  ],
};

// ─── Catalogue export ─────────────────────────────────────────────────────────

export const FRAMEWORK_CATALOGUE: CatalogueFramework[] = [
  ISO_45001,
  ISO_9001,
  ISO_14001,
  ISO_27001,
  GDPR,
];

export function getCatalogueByType(type: CatalogueFrameworkType): CatalogueFramework[] {
  return FRAMEWORK_CATALOGUE.filter((f) => f.type === type);
}

export function getCatalogueEntry(id: string): CatalogueFramework | undefined {
  return FRAMEWORK_CATALOGUE.find((f) => f.id === id);
}
