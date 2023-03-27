import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';

import * as common from '../lib/common';

export class PreparationStack extends cdk.Stack {
    constructor(app: cdk.App, id: string, props?: cdk.StackProps) {
        super(app, id, props);

        console.log('START PreparationStack');

        const scope = this;

        // VPC
        const vpc = new ec2.Vpc(scope, 'VPC', {
            vpcName: common.VPC_NAME,
            maxAzs: 2,
        });

        // EFS
        const fs = createEFS({ scope, vpc });

        // Bastion EC2
        createBastionEC2({ scope, vpc, fs });

        // Service Discovery
        createServiceDiscovery({ scope, vpc });
    }
}

// --------------------------------------------------------------------------------------------------------------------
// EFS
// --------------------------------------------------------------------------------------------------------------------
function createEFS({
    scope,
    vpc,
}: {
    scope: cdk.Stack;
    vpc: ec2.IVpc;
}): efs.FileSystem {
    const store = common.VariableStore;

    // Security Group
    const securityGroup = new ec2.SecurityGroup(scope, 'EFSSecurityGroup', {
        securityGroupName: 'efs-security-group',
        vpc,
        description: 'EFSSecurityGroup',
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(2049), 'Allow access to EFS');

    store.FILE_SYSTEM_SECURITY_GROUP_ID = securityGroup.securityGroupId;


    // EFS
    const fileSystem = new efs.FileSystem(scope, 'FileSystem', {
        vpc,
        securityGroup,
        encrypted: true,
        lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
        performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
        throughputMode: efs.ThroughputMode.BURSTING,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    store.FILE_SYSTEM_ID = fileSystem.fileSystemId;

    return fileSystem;
}

// --------------------------------------------------------------------------------------------------------------------
// Bastion Instance
// --------------------------------------------------------------------------------------------------------------------
function createBastionEC2({
    scope,
    vpc,
    fs,
}: {
    scope: cdk.Stack;
    vpc: ec2.IVpc;
    fs: efs.FileSystem;
}): ec2.Instance {
    // Security Group
    const securityGroup = new ec2.SecurityGroup(scope, 'BastionSecurityGroup', {
        securityGroupName: 'bastion-security-group',
        vpc,
        description: 'Bastion SecurityGroup',
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH');

    const instance = new ec2.Instance(scope, 'Bastion', {
        instanceName: common.BASTION_INSTANCE_NAME,
        vpc,
        securityGroup,
        keyName: common.BASTION_KEY_PAIR_NAME,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.A1, ec2.InstanceSize.MEDIUM),
        machineImage: new ec2.AmazonLinuxImage({
            generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
            edition: ec2.AmazonLinuxEdition.STANDARD,
            cpuType: ec2.AmazonLinuxCpuType.ARM_64,
        }),
        vpcSubnets: {
            subnetType: ec2.SubnetType.PUBLIC,
        }
    });

    fs.connections.allowDefaultPortFrom(instance);

    instance.userData.addCommands(
        "yum check-update -y",
        "yum upgrade -y",
        "yum install -y amazon-efs-utils",
        "yum install -y nfs-utils",
        `file_system_id=${fs.fileSystemId}`,
        "efs_mount_point=/mnt/efs",
        "mkdir -p \"${efs_mount_point}\"",
        "test -f \"/sbin/mount.efs\" && echo \"${file_system_id}:/ ${efs_mount_point} efs defaults,_netdev\" >> /etc/fstab || " +
        "echo \"${file_system_id}.efs." + cdk.Stack.of(scope).region + ".amazonaws.com:/ ${efs_mount_point} nfs4 nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport,_netdev 0 0\" >> /etc/fstab",
        "mount -a -t efs,nfs4 defaults"
    );

    return instance;
}

// --------------------------------------------------------------------------------------------------------------------
// Service Discovery
// --------------------------------------------------------------------------------------------------------------------
function createServiceDiscovery({
    scope,
    vpc,
}: {
    scope: cdk.Stack;
    vpc: ec2.IVpc;
}): servicediscovery.PrivateDnsNamespace {
    const namespace = new servicediscovery.PrivateDnsNamespace(scope, 'Namespace', {
        vpc,
        name: common.NAMESPACE_NAME,
    });

    const store = common.VariableStore;
    store.NAMESPACE_ID = namespace.namespaceId;
    store.NAMESPACE_ARN = namespace.namespaceArn;

    return namespace;
}
