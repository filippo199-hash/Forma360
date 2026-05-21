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

// ─── OSHA 29 CFR 1910 — US General Industry Safety ───────────────────────────

const OSHA_1910: CatalogueFramework = {
  id: 'osha-29-cfr-1910',
  name: 'OSHA 29 CFR 1910',
  shortName: 'OSHA 1910',
  description:
    'US Occupational Safety and Health Administration regulations for general industry. ' +
    'Covers hazard communication, personal protective equipment, lockout/tagout, ' +
    'emergency action plans, and a wide range of industry-specific safety requirements.',
  type: 'health_safety',
  rules: [
    {
      clauseRef: '1910.132',
      name: 'Personal Protective Equipment — general requirements',
      description:
        'Perform hazard assessment to determine necessary PPE. Verify PPE is appropriate, maintained, and employees are trained on its use.',
      frequency: 'yearly',
    },
    {
      clauseRef: '1910.138',
      name: 'Hand protection assessment',
      description:
        'Select and provide appropriate hand protection for tasks with hand-injury risk. Update assessment when job tasks change.',
      frequency: 'yearly',
    },
    {
      clauseRef: '1910.147',
      name: 'Lockout/Tagout (control of hazardous energy)',
      description:
        'Maintain written energy-control procedures for all equipment with hazardous energy. Review procedures annually and after incidents.',
      frequency: 'yearly',
    },
    {
      clauseRef: '1910.157',
      name: 'Fire extinguisher inspection and maintenance',
      description:
        'Perform monthly visual inspections and annual maintenance of portable fire extinguishers. Maintain inspection logs.',
      frequency: 'monthly',
    },
    {
      clauseRef: '1910.165',
      name: 'Employee alarm system test',
      description:
        'Test and maintain the employee alarm system. Verify audibility and visual signals throughout the facility.',
      frequency: 'monthly',
    },
    {
      clauseRef: '1910.178',
      name: 'Powered industrial truck (forklift) inspection',
      description:
        'Conduct pre-shift inspections of all powered industrial trucks. Remove defective equipment from service immediately.',
      frequency: 'daily',
    },
    {
      clauseRef: '1910.212',
      name: 'Machine guarding review',
      description:
        'Inspect all machinery to ensure guards are in place and functioning. Document deficiencies and corrective actions.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '1910.1200',
      name: 'Hazard Communication (HazCom) program review',
      description:
        'Verify Safety Data Sheets (SDS) are current and accessible for all hazardous chemicals. Review labels and employee training records.',
      frequency: 'yearly',
    },
    {
      clauseRef: '1910.38',
      name: 'Emergency Action Plan review',
      description:
        'Review and update the Emergency Action Plan. Conduct drills and verify employee familiarity with evacuation routes and procedures.',
      frequency: 'yearly',
    },
    {
      clauseRef: '1910.151',
      name: 'First aid supplies and medical services',
      description:
        'Inspect first-aid kits and ensure medical emergency response is available. Verify supplies are stocked and not expired.',
      frequency: 'monthly',
    },
  ],
};

// ─── BS OHSAS 18001:2007 — OH&S Management ───────────────────────────────────

const OHSAS_18001: CatalogueFramework = {
  id: 'ohsas-18001-2007',
  name: 'OHSAS 18001:2007',
  shortName: 'OHSAS 18001',
  description:
    'British Standard for Occupational Health and Safety Management Systems, widely adopted globally ' +
    'as a precursor to ISO 45001. Provides a framework for managing OH&S risks, legal compliance, ' +
    'and continual improvement of safety performance.',
  type: 'health_safety',
  rules: [
    {
      clauseRef: '4.3.1',
      name: 'Hazard identification, risk assessment and controls',
      description:
        'Maintain and review hazard identification and risk assessment for all activities. Update after incidents, changes to operations, or at least annually.',
      frequency: 'yearly',
    },
    {
      clauseRef: '4.3.2',
      name: 'Legal and other requirements review',
      description:
        'Identify and maintain access to applicable OH&S legal requirements and other obligations. Review for changes.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '4.4.2',
      name: 'Competence, training and awareness',
      description:
        'Ensure personnel performing safety-critical tasks are competent. Maintain training records and identify gaps.',
      frequency: 'yearly',
    },
    {
      clauseRef: '4.4.6',
      name: 'Operational controls review',
      description:
        'Review operational control procedures for hazardous activities. Ensure controls are effective and documented.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '4.4.7',
      name: 'Emergency preparedness and response drills',
      description:
        'Test emergency response procedures with drills. Review effectiveness and update plans as needed.',
      frequency: 'yearly',
    },
    {
      clauseRef: '4.5.1',
      name: 'Performance measurement and monitoring',
      description:
        'Monitor and measure OH&S performance metrics including leading and lagging indicators. Report results to management.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '4.5.2',
      name: 'Incident investigation and corrective actions',
      description:
        'Investigate accidents, incidents and near-misses. Implement corrective actions and track to closure.',
      frequency: 'monthly',
    },
    {
      clauseRef: '4.5.3',
      name: 'Legal compliance evaluation',
      description:
        'Evaluate compliance with applicable legal requirements and other obligations. Document results and address non-conformances.',
      frequency: 'yearly',
    },
    {
      clauseRef: '4.6',
      name: 'Management review',
      description:
        'Conduct management review of the OH&S management system. Address resource needs, performance trends, and improvement opportunities.',
      frequency: 'yearly',
    },
  ],
};

// ─── IATF 16949:2016 — Automotive Quality ────────────────────────────────────

const IATF_16949: CatalogueFramework = {
  id: 'iatf-16949-2016',
  name: 'IATF 16949:2016',
  shortName: 'IATF 16949',
  description:
    'International quality management standard for the automotive supply chain, developed by the ' +
    'International Automotive Task Force. Combines ISO 9001 requirements with automotive-specific ' +
    'requirements for defect prevention and reduction of variation and waste.',
  type: 'quality',
  rules: [
    {
      clauseRef: '4.3.2',
      name: 'Customer-specific requirements',
      description:
        'Identify, understand and incorporate applicable customer-specific requirements into the QMS. Maintain records of customer requirements and changes.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '6.1.2.1',
      name: 'Risk analysis (FMEA review)',
      description:
        'Maintain and update Failure Mode and Effects Analysis (FMEA) for products and processes. Address high-risk items with preventive actions.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '8.3.3.3',
      name: 'Special characteristics management',
      description:
        'Identify and control special product and process characteristics. Ensure control plans and documentation are updated and communicated to operators.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '8.4.1.2',
      name: 'Supplier monitoring and performance',
      description:
        'Monitor supplier quality performance through delivery metrics, PPM, corrective actions, and customer disruptions. Review and escalate poor performers.',
      frequency: 'monthly',
    },
    {
      clauseRef: '8.5.1.1',
      name: 'Control plan review',
      description:
        'Review and update control plans for all production parts. Ensure control plans reflect current process conditions.',
      frequency: 'yearly',
    },
    {
      clauseRef: '8.5.6.1',
      name: 'Change management — product and process',
      description:
        'Manage engineering changes from internal and external sources. Ensure customer approval is obtained where required before implementation.',
      frequency: 'monthly',
    },
    {
      clauseRef: '8.6.2',
      name: 'Layout inspection and functional testing',
      description:
        'Perform and document periodic layout inspections and functional verifications against design specifications.',
      frequency: 'yearly',
    },
    {
      clauseRef: '8.7.1.4',
      name: 'Customer notification and deviation approval',
      description:
        'Notify customers and obtain approval before shipping non-conforming material. Maintain records of all deviations and approvals.',
      frequency: 'monthly',
    },
    {
      clauseRef: '9.1.1.1',
      name: 'Manufacturing process audit',
      description:
        'Conduct process audits against control plans and process standards. Track and close findings within defined timescales.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '10.2.3',
      name: 'Problem-solving review',
      description:
        'Review open customer complaints and internal non-conformances. Verify corrective actions are implemented and effective.',
      frequency: 'monthly',
    },
  ],
};

// ─── ISO 13485:2016 — Medical Devices Quality ─────────────────────────────────

const ISO_13485: CatalogueFramework = {
  id: 'iso-13485-2016',
  name: 'ISO 13485:2016',
  shortName: 'ISO 13485',
  description:
    'International standard for quality management systems specific to medical device manufacturers ' +
    'and related services. Emphasises risk management, regulatory compliance, and the safety and ' +
    'performance of medical devices throughout their lifecycle.',
  type: 'quality',
  rules: [
    {
      clauseRef: '4.2.3',
      name: 'Medical device file review',
      description:
        'Maintain and review the medical device file for each device type or family. Ensure records of design, manufacturing, and regulatory documents are current.',
      frequency: 'yearly',
    },
    {
      clauseRef: '6.2',
      name: 'Personnel competency verification',
      description:
        'Verify personnel performing quality-critical activities are competent. Maintain training records and evaluate training effectiveness.',
      frequency: 'yearly',
    },
    {
      clauseRef: '6.4.2',
      name: 'Contamination control review',
      description:
        'Review contamination control arrangements for sterile or clean-room products. Verify procedures are followed and documented.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '7.4',
      name: 'Supplier qualification and re-evaluation',
      description:
        'Evaluate and re-qualify suppliers of products and services affecting device quality. Maintain approved supplier records and performance data.',
      frequency: 'yearly',
    },
    {
      clauseRef: '7.5.9',
      name: 'Traceability records review',
      description:
        'Verify traceability records for implantable devices and those requiring unique device identification (UDI). Ensure records are complete and accessible.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '7.6',
      name: 'Monitoring and measurement equipment calibration',
      description:
        'Review calibration status of all monitoring and measuring equipment. Ensure certificates are current and out-of-tolerance instruments are quarantined.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '8.2.1',
      name: 'Customer feedback and complaint review',
      description:
        'Review and analyse customer complaints and feedback. Assess whether complaints meet reportability thresholds for regulatory notification.',
      frequency: 'monthly',
    },
    {
      clauseRef: '8.3',
      name: 'Non-conforming product control review',
      description:
        'Review disposition of non-conforming products. Ensure investigation, corrective action, and customer/regulatory notifications are completed as required.',
      frequency: 'monthly',
    },
    {
      clauseRef: '8.5.1',
      name: 'CAPA system effectiveness review',
      description:
        'Review open and closed corrective and preventive actions (CAPA). Verify root causes are addressed and actions are effective.',
      frequency: 'quarterly',
    },
  ],
};

// ─── ISO 50001:2018 — Energy Management ──────────────────────────────────────

const ISO_50001: CatalogueFramework = {
  id: 'iso-50001-2018',
  name: 'ISO 50001:2018',
  shortName: 'ISO 50001',
  description:
    'International standard for energy management systems. Helps organisations establish systems ' +
    'and processes to improve energy performance, efficiency and consumption, contributing to ' +
    'reduced energy costs and greenhouse gas emissions.',
  type: 'environmental',
  rules: [
    {
      clauseRef: '4.3',
      name: 'Scope and boundaries of energy management system',
      description:
        'Review and update the defined scope and boundaries of the EnMS. Ensure all significant energy users are included.',
      frequency: 'yearly',
    },
    {
      clauseRef: '6.3',
      name: 'Energy review and significant energy uses (SEUs)',
      description:
        'Conduct or update the energy review. Identify significant energy uses and relevant variables. Analyse trends and improvement opportunities.',
      frequency: 'yearly',
    },
    {
      clauseRef: '6.4',
      name: 'Energy performance indicators (EnPIs) review',
      description:
        'Review energy performance indicators to assess actual vs. expected energy performance. Investigate and address significant deviations.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '6.5',
      name: 'Energy baseline update',
      description:
        'Review the energy baseline. Normalise for relevant variables and update when operations change significantly.',
      frequency: 'yearly',
    },
    {
      clauseRef: '6.6',
      name: 'Energy objectives and targets review',
      description:
        'Review progress against energy objectives and targets. Adjust action plans where targets are at risk.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '8.1',
      name: 'Operational controls for significant energy uses',
      description:
        'Verify operational controls for SEUs are in place and effective. Update procedures when operational conditions change.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '8.2',
      name: 'Design review for energy performance',
      description:
        'Include energy performance requirements in the design of new facilities, equipment, and processes. Maintain design review records.',
      frequency: 'yearly',
    },
    {
      clauseRef: '9.1.1',
      name: 'Energy data monitoring and measurement',
      description:
        'Monitor, measure and analyse energy data. Ensure metering equipment is calibrated and data is accurate.',
      frequency: 'monthly',
    },
    {
      clauseRef: '9.3',
      name: 'Management review of energy performance',
      description:
        'Present energy performance data and EnMS results to top management. Record decisions and actions.',
      frequency: 'yearly',
    },
  ],
};

// ─── EMAS — EU Eco-Management and Audit Scheme ────────────────────────────────

const EMAS: CatalogueFramework = {
  id: 'emas-eu',
  name: 'EMAS (EU) Regulation 1221/2009',
  shortName: 'EMAS',
  description:
    'The EU Eco-Management and Audit Scheme (EMAS) is a voluntary EU regulation for organisations ' +
    'that commit to continual environmental performance improvement, legal compliance, and public ' +
    'transparency through an environmental statement. Extends beyond ISO 14001 with mandatory ' +
    'public reporting.',
  type: 'environmental',
  rules: [
    {
      clauseRef: 'Art. 4(1)(a)',
      name: 'Environmental review',
      description:
        'Conduct or update the initial environmental review covering all environmental aspects, applicable legal requirements, and existing management practices.',
      frequency: 'yearly',
    },
    {
      clauseRef: 'Art. 4(1)(b)',
      name: 'Environmental policy review',
      description:
        'Review and update the environmental policy. Ensure commitments to compliance, prevention of pollution, and continual improvement are current.',
      frequency: 'yearly',
    },
    {
      clauseRef: 'Art. 4(1)(c)',
      name: 'Environmental objectives and programme',
      description:
        'Review environmental objectives and targets. Update the environmental management programme with actions, responsibilities, and timescales.',
      frequency: 'yearly',
    },
    {
      clauseRef: 'Art. 4(1)(d)',
      name: 'Environmental management system audit',
      description:
        'Conduct internal audit of the EMS. Verify compliance with EMAS requirements and legal obligations. Address non-conformances.',
      frequency: 'yearly',
    },
    {
      clauseRef: 'Annex IV',
      name: 'Environmental statement preparation and validation',
      description:
        'Prepare the annual/biennial environmental statement with key environmental indicators. Submit to an accredited EMAS verifier.',
      frequency: 'yearly',
    },
    {
      clauseRef: 'Art. 9',
      name: 'Legal compliance evaluation',
      description:
        'Evaluate compliance with all applicable environmental legislation. Document findings and implement corrective actions for any breaches.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Annex IV (core)',
      name: 'Core indicators data collection',
      description:
        'Collect and verify data for EMAS core indicators: energy, materials, water, waste, biodiversity land use, and emissions.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Art. 4(4)',
      name: 'Employee involvement and training',
      description:
        'Ensure employees are actively involved in the environmental improvement process. Verify environmental awareness training is current.',
      frequency: 'yearly',
    },
  ],
};

// ─── SOC 2 Type II — System and Organisation Controls ─────────────────────────

const SOC2: CatalogueFramework = {
  id: 'soc-2-type-ii',
  name: 'SOC 2 Type II',
  shortName: 'SOC 2',
  description:
    'AICPA System and Organisation Controls report for service organisations. Evaluates the design ' +
    'and operating effectiveness of controls related to security, availability, processing integrity, ' +
    'confidentiality, and privacy (Trust Service Criteria) over an audit period, typically 12 months.',
  type: 'regulatory',
  rules: [
    {
      clauseRef: 'CC6.1',
      name: 'Logical access controls review',
      description:
        'Review logical access to systems, applications, and data. Verify least-privilege, multi-factor authentication, and access provisioning/de-provisioning processes.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'CC6.2',
      name: 'User access review',
      description:
        'Perform formal user access review for all systems in scope. Revoke unnecessary access and document evidence of review.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'CC6.3',
      name: 'Privileged access monitoring',
      description:
        'Monitor and review privileged account activity. Verify that privileged access is limited and activity is logged.',
      frequency: 'monthly',
    },
    {
      clauseRef: 'CC7.1',
      name: 'Vulnerability scanning',
      description:
        'Run vulnerability scans on in-scope systems. Remediate critical and high-severity findings within defined SLAs.',
      frequency: 'monthly',
    },
    {
      clauseRef: 'CC7.2',
      name: 'Security monitoring and anomaly detection',
      description:
        'Review security event logs and alerts from SIEM or monitoring tools. Investigate and document anomalies.',
      frequency: 'monthly',
    },
    {
      clauseRef: 'CC8.1',
      name: 'Change management review',
      description:
        'Review change management records for system changes. Verify authorisation, testing, and approval controls are functioning.',
      frequency: 'monthly',
    },
    {
      clauseRef: 'CC9.1',
      name: 'Vendor and third-party risk review',
      description:
        'Review vendor risk assessments and third-party security posture. Verify contracts include appropriate security requirements.',
      frequency: 'yearly',
    },
    {
      clauseRef: 'A1.2',
      name: 'Capacity planning and availability monitoring',
      description:
        'Monitor system capacity and performance metrics. Verify availability SLAs are being met and capacity planning is adequate.',
      frequency: 'monthly',
    },
    {
      clauseRef: 'CC9.2',
      name: 'Incident response plan test',
      description:
        'Test the incident response plan through tabletop exercises or drills. Update the plan based on lessons learned.',
      frequency: 'yearly',
    },
    {
      clauseRef: 'CC5.3',
      name: 'Risk assessment',
      description:
        'Perform or update the formal risk assessment for in-scope systems. Assign risk ratings and track risk treatment plans.',
      frequency: 'yearly',
    },
  ],
};

// ─── HIPAA — US Healthcare Privacy & Security ─────────────────────────────────

const HIPAA: CatalogueFramework = {
  id: 'hipaa-us',
  name: 'HIPAA Security & Privacy Rule',
  shortName: 'HIPAA',
  description:
    'US Health Insurance Portability and Accountability Act. The Privacy Rule protects individuals\' ' +
    'medical records and personal health information; the Security Rule sets standards for protecting ' +
    'electronic Protected Health Information (ePHI) held or transferred by covered entities and ' +
    'business associates.',
  type: 'regulatory',
  rules: [
    {
      clauseRef: '164.308(a)(1)',
      name: 'Security risk analysis',
      description:
        'Conduct or update the security risk analysis of ePHI. Identify threats, vulnerabilities, and likelihood of compromise. Document findings.',
      frequency: 'yearly',
    },
    {
      clauseRef: '164.308(a)(3)',
      name: 'Workforce authorisation and access review',
      description:
        'Review workforce member access to ePHI. Verify access is appropriate to job function and unauthorised access is prevented.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '164.308(a)(5)',
      name: 'Security awareness training',
      description:
        'Ensure all workforce members receive periodic HIPAA security awareness training. Maintain training records.',
      frequency: 'yearly',
    },
    {
      clauseRef: '164.308(a)(6)',
      name: 'Security incident procedures review',
      description:
        'Review security incident response procedures. Verify incidents are being identified, documented, and responded to appropriately.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '164.308(b)(1)',
      name: 'Business Associate Agreement (BAA) review',
      description:
        'Review all Business Associate Agreements. Ensure BAAs are in place with all vendors accessing ePHI and reflect current requirements.',
      frequency: 'yearly',
    },
    {
      clauseRef: '164.312(a)(2)(iv)',
      name: 'Encryption and decryption controls',
      description:
        'Verify ePHI is encrypted at rest and in transit. Review encryption key management procedures.',
      frequency: 'quarterly',
    },
    {
      clauseRef: '164.312(b)',
      name: 'Audit controls — ePHI access logs',
      description:
        'Review audit logs for ePHI access. Investigate anomalies such as after-hours access, bulk exports, or access by terminated employees.',
      frequency: 'monthly',
    },
    {
      clauseRef: '164.316(b)',
      name: 'Policy and procedure review',
      description:
        'Review HIPAA policies and procedures for currency and accuracy. Update to reflect changes in operations, regulations, or risk landscape.',
      frequency: 'yearly',
    },
    {
      clauseRef: '164.530(j)',
      name: 'Privacy breach risk assessment',
      description:
        'Assess any privacy incidents for breach notification requirements. Document four-factor low-probability-of-compromise assessment where applicable.',
      frequency: 'monthly',
    },
  ],
};

// ─── PCI DSS v4.0 — Payment Card Industry Data Security ──────────────────────

const PCI_DSS: CatalogueFramework = {
  id: 'pci-dss-v4-0',
  name: 'PCI DSS v4.0',
  shortName: 'PCI DSS',
  description:
    'Payment Card Industry Data Security Standard, maintained by the PCI Security Standards Council. ' +
    'Applies to all entities that store, process, or transmit cardholder data. Version 4.0 ' +
    'introduces enhanced flexibility with customised implementations and stronger authentication ' +
    'and encryption requirements.',
  type: 'regulatory',
  rules: [
    {
      clauseRef: 'Req. 1',
      name: 'Network security controls review',
      description:
        'Review firewall and network security control configurations. Verify CDE is segmented from out-of-scope networks and rules are documented and current.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Req. 2',
      name: 'Default credential and configuration hardening',
      description:
        'Verify no default passwords are in use on in-scope systems. Review system configuration against hardening standards.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Req. 3',
      name: 'Cardholder data discovery and inventory',
      description:
        'Identify all locations where cardholder data (CHD) is stored. Verify only authorised retention and no prohibited data (CVV, full-track) is stored post-authorisation.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Req. 5',
      name: 'Anti-malware controls review',
      description:
        'Verify anti-malware software is deployed, active, and definitions are current on all in-scope systems.',
      frequency: 'monthly',
    },
    {
      clauseRef: 'Req. 6',
      name: 'Vulnerability management and patching',
      description:
        'Review patch status for in-scope systems. Verify critical patches are applied within defined SLA (typically 30 days).',
      frequency: 'monthly',
    },
    {
      clauseRef: 'Req. 7',
      name: 'Access control and least privilege review',
      description:
        'Review access to cardholder data components. Verify least privilege and need-to-know principles are enforced.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Req. 8',
      name: 'User authentication and MFA review',
      description:
        'Verify multi-factor authentication is enforced for all non-console access to the CDE and remote access. Review account management controls.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Req. 10',
      name: 'Audit log review',
      description:
        'Review audit logs for in-scope systems for anomalies. Verify logs are complete, protected, and retained for at least 12 months.',
      frequency: 'monthly',
    },
    {
      clauseRef: 'Req. 11',
      name: 'Internal vulnerability scan',
      description:
        'Conduct quarterly internal vulnerability scan of in-scope networks. Remediate high-severity findings and re-scan to confirm resolution.',
      frequency: 'quarterly',
    },
    {
      clauseRef: 'Req. 12',
      name: 'Information security policy review',
      description:
        'Review and update the information security policy. Ensure all personnel are aware of their responsibilities.',
      frequency: 'yearly',
    },
  ],
};

export const FRAMEWORK_CATALOGUE: CatalogueFramework[] = [
  // Health & Safety
  ISO_45001,
  OSHA_1910,
  OHSAS_18001,
  // Quality
  ISO_9001,
  IATF_16949,
  ISO_13485,
  // Environmental
  ISO_14001,
  ISO_50001,
  EMAS,
  // Regulatory
  ISO_27001,
  GDPR,
  SOC2,
  HIPAA,
  PCI_DSS,
];

export function getCatalogueByType(type: CatalogueFrameworkType): CatalogueFramework[] {
  return FRAMEWORK_CATALOGUE.filter((f) => f.type === type);
}

export function getCatalogueEntry(id: string): CatalogueFramework | undefined {
  return FRAMEWORK_CATALOGUE.find((f) => f.id === id);
}
