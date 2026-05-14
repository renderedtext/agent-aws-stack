package trivy

default ignore = false

ignore {
	deny_vulnerability_ids := {
		#
		# aws-cdk-lib bundles fast-uri inside its published tarball.
		# The latest published aws-cdk-lib release still embeds the vulnerable copy,
		# so this repository cannot remediate these findings without a CDK upstream fix.
		#
		"CVE-2026-6321",
		"CVE-2026-6322"
	}

	input.VulnerabilityID = deny_vulnerability_ids[_]
}
