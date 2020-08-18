import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ecsPatterns from "@aws-cdk/aws-ecs-patterns";
import * as serviceDiscovery from "@aws-cdk/aws-servicediscovery";
import * as iam from "@aws-cdk/aws-iam";
import { NetworkLoadBalancedTaskImageOptions } from "@aws-cdk/aws-ecs-patterns";

const environment = "ecsworkshop";

// Creating a construct that will populate the required objects created in the platform repo such as vpc, ecs cluster, and service discovery namespace
class BasePlatform extends cdk.Stack {
  environmentName: string;
  vpc: ec2.IVpc;
  sdNamespace: serviceDiscovery.IPrivateDnsNamespace;
  ecsCluster: ecs.ICluster;
  servicesSecGrp: ec2.ISecurityGroup;
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The base platform stack is where the VPC was created, so all we need is the name to do a lookup and import it into this stack for use
    this.vpc = ec2.Vpc.fromLookup(this, "VPC", {
      vpcName: `${environment}-base/BaseVPC`,
    });

    this.sdNamespace = serviceDiscovery.PrivateDnsNamespace.fromPrivateDnsNamespaceAttributes(
      this,
      "SDNamespace",
      {
        namespaceName: cdk.Fn.importValue("NSNAME"),
        namespaceArn: cdk.Fn.importValue("NSARN"),
        namespaceId: cdk.Fn.importValue("NSID"),
      }
    );

    this.ecsCluster = ecs.Cluster.fromClusterAttributes(this, "ECSCluster", {
      clusterName: cdk.Fn.importValue("ECSClusterName"),
      securityGroups: [],
      vpc: this.vpc,
      defaultCloudMapNamespace: this.sdNamespace,
    });

    this.servicesSecGrp = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "ServicesSecGrp",
      cdk.Fn.importValue("ServicesSecGrp")
    );
  }
}

class FrontendService extends cdk.Stack {
  basePlatform: BasePlatform;
  fargateTaskImage: NetworkLoadBalancedTaskImageOptions;
  fargateteLoadBalancedService: ecsPatterns.ApplicationLoadBalancedFargateService;
  autoScale: ecs.ScalableTaskCount;
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.basePlatform = new BasePlatform(this, this.stackName, props);
    this.fargateTaskImage = {
      image: ecs.ContainerImage.fromRegistry("adam9098/ecsdemo-frontend"),
      containerPort: 3000,
      environment: {
        CRYSTAL_URL: "http://ecsdemo-crystal.service:3000/crystal",
        NODEJS_URL: "http://ecsdemo-nodejs.service:3000",
        REGION: process.env.AWS_DEFAULT_REGION || "eu-central-1",
      },
    };
    this.fargateteLoadBalancedService = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      "FrontendFargateLBService",
      {
        serviceName: "ecsdemo-frontend",
        cluster: this.basePlatform.ecsCluster,
        cpu: 256,
        memoryLimitMiB: 512,
        desiredCount: 1,
        publicLoadBalancer: true,
        cloudMapOptions: { cloudMapNamespace: this.basePlatform.sdNamespace },
        taskImageOptions: this.fargateTaskImage,
      }
    );
    this.fargateteLoadBalancedService.taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["ec2:DescribeSubnets"],
        resources: ["*"],
      })
    );
    this.fargateteLoadBalancedService.service.connections.allowTo(
      this.basePlatform.servicesSecGrp,
      new ec2.Port({
        protocol: ec2.Protocol.TCP,
        stringRepresentation: "frontendtobackend",
        fromPort: 3000,
        toPort: 3000,
      })
    );

    //Enable service autoscaling
    /*
    this.autoScale = this.fargateteLoadBalancedService.service.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 10})
    this.autoScale.scaleOnCpuUtilization('CPUAutoscaling', {targetUtilizationPercent: 50, scaleInCooldown: cdk.Duration.seconds(30), scaleOutCooldown: cdk.Duration.seconds(30)})
     */
  }
}

const env: cdk.Environment = {
  account: process.env.AWS_ACCOUNT_ID || process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.AWS_DEFAULT_REGION || process.env.CDK_DEFAULT_REGION,
};

const stack_name = `${environment}-frontend`;
const app = new cdk.App();
new FrontendService(app, stack_name, { env });
app.synth();
